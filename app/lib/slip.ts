// Printable packing slips and the customer list, rendered as one plain HTML
// document per print run. The browser prints it (or saves it as PDF), so
// there's no headless Chrome to run on Vercel. Pure: no server imports, so
// it's unit-tested directly.
import { addDays, isWeekend, shortDay, type IsoDate } from "./dates";
import { cToF, type Unit } from "./format";
import { weatherIcon } from "./weather-icons";
import { DISTANCE_UNITS, formatDistance, type DistanceUnit, type SlipDistance } from "./distance";
import { orderCodeSvg, type OrderCodeKind } from "./order-code";
import { conditionLabel, isSlipLanguage, slipLocale, slipStrings, type SlipLanguage, type SlipStrings } from "./slip-i18n";
import type { PrintAddress, PrintOrder, PrintShop } from "./orders.server";
import type { ForecastPayload } from "./weather/types";

export interface SlipDay {
  date: IsoDate;
  minC: number;
  maxC: number;
  precipProb: number | null;
  label: string;
}

interface SlipBase {
  city: string | null;
  countryCode: string | null;
  dispatch: IsoDate;
  delivery: IsoDate;
}

export type SlipWeather =
  | (SlipBase & {
      status: "ok";
      current: { tempC: number; label: string } | null;
      days: SlipDay[];
      /** Last date the provider forecasts. */
      horizonEnd: IsoDate;
      asOf: string;
      /** Weather provider id (WeatherProvider.id); credited on the slip. */
      source: string;
    })
  | (SlipBase & { status: "no_location" | "limit_reached" | "error" });

/**
 * Read a forecast saved on an order (weather_slip.forecast) back into a
 * printable SlipWeather. Anything malformed reads as null, so the slip just
 * fetches fresh weather instead of printing garbage.
 */
export function parseSavedSlipWeather(
  value: string | null | undefined,
): SlipWeather | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as Record<string, unknown>;
    const str = (x: unknown) => typeof x === "string";
    const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
    if (
      v.status !== "ok" ||
      !str(v.dispatch) ||
      !str(v.delivery) ||
      !str(v.horizonEnd) ||
      !str(v.asOf)
    ) {
      return null;
    }
    if (!Array.isArray(v.days)) return null;
    const days: SlipDay[] = [];
    for (const d of v.days as Record<string, unknown>[]) {
      if (!d || !str(d.date) || !num(d.minC) || !num(d.maxC) || !str(d.label))
        return null;
      days.push({
        date: d.date as string,
        minC: d.minC as number,
        maxC: d.maxC as number,
        precipProb: num(d.precipProb) ? (d.precipProb as number) : null,
        label: d.label as string,
      });
    }
    const cur = v.current as Record<string, unknown> | null | undefined;
    return {
      status: "ok",
      city: str(v.city) ? (v.city as string) : null,
      countryCode: str(v.countryCode) ? (v.countryCode as string) : null,
      dispatch: v.dispatch as string,
      delivery: v.delivery as string,
      current:
        cur && num(cur.tempC) && str(cur.label)
          ? { tempC: cur.tempC as number, label: cur.label as string }
          : null,
      days,
      horizonEnd: v.horizonEnd as string,
      asOf: v.asOf as string,
      // Saved before the source was recorded: OpenWeather was the only
      // provider in production then.
      source: str(v.source) ? (v.source as string) : "openweather",
    };
  } catch {
    return null;
  }
}

/** Every forecast day from today at the destination through the horizon. */
export function slipForecast(
  forecast: ForecastPayload,
  today: IsoDate,
  horizonDays: number,
): {
  current: { tempC: number; label: string } | null;
  days: SlipDay[];
  horizonEnd: IsoDate;
} {
  const horizonEnd = addDays(today, horizonDays);
  const days = forecast.daily
    .filter((d) => d.date >= today && d.date <= horizonEnd)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, minC, maxC, precipProb, label }) => ({
      date,
      minC,
      maxC,
      precipProb,
      label,
    }));
  return {
    current: forecast.current
      ? { tempC: forecast.current.tempC, label: forecast.current.label }
      : null,
    days,
    horizonEnd,
  };
}

export function escapeHtml(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function temp(c: number, unit: Unit): string {
  const rc = Math.round(c);
  if (unit === "C") return `${rc}°C`;
  if (unit === "F") return `${cToF(c)}°F`;
  return `${rc}°C / ${cToF(c)}°F`;
}

function longDate(iso: string, timeZone: string, locale = "en-GB"): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** "Thursday, 17 October 2026" for a calendar date. */
function longDay(date: IsoDate, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

// ---------- templates ----------

export type SlipTemplate = "CLASSIC" | "MINIMAL" | "DETAILED" | "LABEL_4X6";
export type PaperSize = "A4" | "A5" | "LETTER" | "LEGAL";

export const PAPER_SIZES: {
  id: PaperSize;
  label: string;
  css: string;
  maxWidth: string;
  /** Sheet size in CSS px (96/in), for fitting a slip onto one page. */
  px: [number, number];
}[] = [
  { id: "A4", label: "A4 (210 × 297 mm)", css: "A4", maxWidth: "210mm", px: [793.7, 1122.5] },
  { id: "A5", label: "A5 (148 × 210 mm)", css: "A5", maxWidth: "148mm", px: [559.4, 793.7] },
  {
    id: "LETTER",
    label: "US Letter (8.5 × 11 in)",
    css: "letter",
    maxWidth: "8.5in",
    px: [816, 1056],
  },
  {
    id: "LEGAL",
    label: "US Legal (8.5 × 14 in)",
    css: "legal",
    maxWidth: "8.5in",
    px: [816, 1344],
  },
];

export const SLIP_TEMPLATES: {
  id: SlipTemplate;
  name: string;
  description: string;
}[] = [
  {
    id: "CLASSIC",
    name: "Classic",
    description:
      "Full page: addresses, forecast cards, product images, store footer.",
  },
  {
    id: "MINIMAL",
    name: "Minimal",
    description:
      "Ink saver: no images or shading, forecast as a compact table.",
  },
  {
    id: "DETAILED",
    name: "Detailed",
    description:
      "Classic plus prices, line totals and order totals — doubles as a receipt.",
  },
  {
    id: "LABEL_4X6",
    name: "Shipping label",
    description:
      "For thermal label printers: big ship-to address, forecast and items on a 4×6 or 4×4 in label.",
  },
];

export type LogoPosition = "left" | "center" | "right";
export type SizeKey = "S" | "M" | "L";
export type FontSizeKey = "XS" | "S" | "M" | "L" | "XL";
export type LabelSize = "4x6" | "4x4";

// System font stacks only: the print page's CSP loads nothing external.
export const FONTS = {
  system: {
    label: "System sans-serif (default)",
    css: '-apple-system, "Segoe UI", Arial, sans-serif',
  },
  helvetica: {
    label: "Helvetica / Arial",
    css: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  },
  verdana: {
    label: "Verdana (wide, very legible)",
    css: "Verdana, Geneva, sans-serif",
  },
  trebuchet: {
    label: "Trebuchet",
    css: '"Trebuchet MS", "Lucida Grande", sans-serif',
  },
  georgia: { label: "Georgia (serif)", css: "Georgia, Cambria, serif" },
  times: {
    label: "Times New Roman (serif)",
    css: '"Times New Roman", Times, serif',
  },
  garamond: {
    label: "Garamond (elegant serif)",
    css: 'Garamond, "EB Garamond", Baskerville, serif',
  },
  courier: {
    label: "Courier (typewriter)",
    css: '"Courier New", Courier, monospace',
  },
  mono: {
    label: "Monospace (receipt)",
    css: '"SFMono-Regular", Menlo, Consolas, monospace',
  },
} as const;
export type FontKey = keyof typeof FONTS;

export const FONT_SIZES: { id: FontSizeKey; label: string; px: number }[] = [
  { id: "XS", label: "Extra small (10 pt)", px: 10 },
  { id: "S", label: "Small (11 pt)", px: 11 },
  { id: "M", label: "Medium (12 pt)", px: 12 },
  { id: "L", label: "Large (13.5 pt)", px: 13.5 },
  { id: "XL", label: "Extra large (15 pt)", px: 15 },
];

/**
 * Everything a merchant can customise beyond the template (Shop.slipDesign
 * JSON). Every value read from storage or a request goes through
 * sanitizeDesign, so the renderer can trust it.
 */
export type LogoSource = "store" | "custom" | "none";

export interface SlipDesign {
  /** store = Shopify → Settings → Brand logo; custom = logoUrl; none. */
  logoSource: LogoSource;
  /** Custom logo link. https://cdn.shopify.com/… only — the print page's CSP allows no other image host. */
  logoUrl: string | null;
  logoPosition: LogoPosition;
  /** Title across the middle of the page, or at the left (full-page templates). */
  titleAlign: "center" | "left";
  logoSize: SizeKey; // legacy preset; logoHeight wins
  /** Logo height in px on full-page templates (labels scale it down). */
  logoHeight: number;
  /** Widest the logo may get, in px, so wide wordmarks don't overrun. */
  logoMaxWidth: number;
  /** null = the template's own title ("Packing slip"). */
  title: string | null;
  /** Message shown under the header, e.g. "Live plants — open on arrival". */
  headerNote: string | null;
  showOrderDate: boolean;
  showShippingMethod: boolean;
  showPhone: boolean;
  showWeather: boolean;
  showNow: boolean;
  showDates: boolean;
  showRain: boolean;
  showAsOf: boolean;
  showStoreName: boolean;
  showStoreAddress: boolean;
  showStoreEmail: boolean;
  showStoreWebsite: boolean;
  /** Customer email (needs Email in protected customer data access). */
  showEmail: boolean;
  showPaymentStatus: boolean;
  showItemCount: boolean;
  // Line items
  itemImageSize: SizeKey;
  /** Shorten long product titles to this many characters; 0 = full. */
  titleMax: 0 | 30 | 50 | 80;
  showVariant: boolean;
  showVendor: boolean;
  showBarcode: boolean;
  /** Line item properties (engraving, personalisation…). */
  showProperties: boolean;
  /** Unit price + line total on any template (Detailed always shows them). */
  showPrices: boolean;
  showCompareAt: boolean;
  showTotals: boolean;
  qtyFormat: "of" | "plain";
  itemsScope: "unfulfilled" | "all";
  itemSort: "order" | "name" | "sku";
  /** Cart attributes (gift message, delivery instructions…). */
  showCartAttributes: boolean;
  /** Straight-line distance from the fulfillment location to the destination. */
  showDistance: boolean;
  distanceUnit: DistanceUnit;
  /** "order" = each order's assigned fulfillment location; else a numeric Location id. */
  distanceFrom: string;
  /** Extra footer text (returns policy, care notes); line breaks kept. */
  footerExtra: string | null;
  accent: string; // #rrggbb
  font: FontKey;
  fontSize: FontSizeKey;
  labelSize: LabelSize;
  /** Printed wording (Pro and Business — planSlipOptions clamps it). */
  language: SlipLanguage;
  /** "Weather Slip" mark at the foot of each page (only Business may hide it). */
  showBranding: boolean;
  /** "all" = today → horizon; "trip" = dispatch day → delivery day only. */
  forecastRange: "all" | "trip";
  /** Dispatch date, tag and highlight (Starter and up — planSlipOptions). */
  showDispatch: boolean;
  /**
   * Forecast days after the first (fetch-day) day to print. Set by the plan
   * (planSlipOptions), never by the merchant; the full forecast stays saved
   * on the order, so an upgrade shows more days on old orders too.
   */
  maxDaysAhead: number;
  /**
   * "Count weekdays only" (the shop's shipping setting, set via
   * planSlipOptions): maxDaysAhead counts weekdays and weekend days are left
   * off the forecast, matching how dispatch/delivery dates are counted.
   */
  skipWeekends: boolean;
  /** One line of advice when delivery day brings rain, frost or heat. */
  showTip: boolean;
  /** Scannable order number in the header, for warehouses. */
  orderCode: OrderCodeKind;
  /** Faint watermark behind each slip (plan-tiered — see planSlipOptions). */
  watermark: "none" | "text" | "logo";
  watermarkText: string | null;
  watermarkSize: SizeKey;
  watermarkAngle: "diagonal" | "flat";
  watermarkOpacity: "light" | "medium" | "strong";
}

export const DEFAULT_SLIP_DESIGN: SlipDesign = {
  logoSource: "store",
  logoUrl: null,
  logoPosition: "left",
  titleAlign: "center",
  logoSize: "M",
  logoHeight: 56,
  logoMaxWidth: 220,
  title: null,
  headerNote: null,
  showOrderDate: true,
  showShippingMethod: true,
  showPhone: true,
  showWeather: true,
  showNow: true,
  showDates: true,
  showRain: true,
  showAsOf: true,
  showStoreName: true,
  showStoreAddress: true,
  showStoreEmail: true,
  showStoreWebsite: true,
  showEmail: false,
  showPaymentStatus: false,
  showItemCount: true,
  itemImageSize: "M",
  titleMax: 0,
  showVariant: true,
  showVendor: false,
  showBarcode: false,
  showProperties: true,
  showPrices: false,
  showCompareAt: true,
  showTotals: false,
  qtyFormat: "of",
  itemsScope: "unfulfilled",
  itemSort: "order",
  showCartAttributes: true,
  showDistance: false,
  distanceUnit: "km",
  distanceFrom: "order",
  footerExtra: null,
  accent: "#111111",
  font: "system",
  fontSize: "M",
  labelSize: "4x6",
  language: "en",
  showBranding: true,
  forecastRange: "all",
  showDispatch: true,
  maxDaysAhead: 4,
  skipWeekends: false,
  showTip: true,
  orderCode: "none",
  watermark: "none",
  watermarkText: null,
  watermarkSize: "M",
  watermarkAngle: "diagonal",
  watermarkOpacity: "light",
};

/** Starter's watermark choices; Pro and Business may type their own. */
export const WATERMARK_PRESETS = [
  "PAID",
  "FRAGILE",
  "GIFT",
  "HANDLE WITH CARE",
  "THANK YOU",
  "SAMPLE",
  "COPY",
] as const;

export const TEXT_MAX = {
  watermarkText: 40,
  title: 60,
  headerNote: 200,
  footerExtra: 600,
} as const;

export const isShopifyCdnUrl = (v: string) =>
  /^https:\/\/cdn\.shopify\.com\/[^\s"'<>]{1,480}$/.test(v);

export const LOGO_PRESET_PX: Record<SizeKey, number> = { S: 36, M: 56, L: 80 };

function clampInt(
  v: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.round(n)))
    : fallback;
}

/** Coerce anything (stored JSON, a request body) into a valid design. */
export function sanitizeDesign(raw: unknown): SlipDesign {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const d = DEFAULT_SLIP_DESIGN;
  const bool = (k: keyof SlipDesign) =>
    typeof r[k] === "boolean" ? (r[k] as boolean) : (d[k] as boolean);
  const pick = <T extends string>(
    k: keyof SlipDesign,
    allowed: readonly T[],
  ): T => (allowed.includes(r[k] as T) ? (r[k] as T) : (d[k] as T));
  const text = (k: keyof typeof TEXT_MAX) => {
    const v = r[k];
    if (typeof v !== "string") return d[k] as string | null;
    const t = v.slice(0, TEXT_MAX[k]);
    return t.trim() ? t : null;
  };
  const logo = typeof r.logoUrl === "string" ? r.logoUrl.trim() : "";
  const logoUrl = logo && isShopifyCdnUrl(logo) ? logo : null;
  return {
    // Saves from before logoSource existed: a custom link meant "custom".
    logoSource:
      r.logoSource === undefined && logoUrl
        ? "custom"
        : pick("logoSource", ["store", "custom", "none"] as const),
    logoUrl,
    logoPosition: pick("logoPosition", ["left", "center", "right"] as const),
    titleAlign: pick("titleAlign", ["center", "left"] as const),
    logoSize: pick("logoSize", ["S", "M", "L"] as const),
    // Older saves only had a preset size; map it to pixels.
    logoHeight: clampInt(
      r.logoHeight,
      20,
      200,
      LOGO_PRESET_PX[pick("logoSize", ["S", "M", "L"] as const)],
    ),
    logoMaxWidth: clampInt(r.logoMaxWidth, 60, 500, d.logoMaxWidth),
    title: text("title"),
    headerNote: text("headerNote"),
    showOrderDate: bool("showOrderDate"),
    showShippingMethod: bool("showShippingMethod"),
    showPhone: bool("showPhone"),
    showWeather: bool("showWeather"),
    showNow: bool("showNow"),
    showDates: bool("showDates"),
    showRain: bool("showRain"),
    showAsOf: bool("showAsOf"),
    showStoreName: bool("showStoreName"),
    showStoreAddress: bool("showStoreAddress"),
    showStoreEmail: bool("showStoreEmail"),
    showStoreWebsite: bool("showStoreWebsite"),
    showEmail: bool("showEmail"),
    showPaymentStatus: bool("showPaymentStatus"),
    showItemCount: bool("showItemCount"),
    itemImageSize: pick("itemImageSize", ["S", "M", "L"] as const),
    titleMax:
      ([0, 30, 50, 80] as const).find((n) => n === r.titleMax) ?? d.titleMax,
    showVariant: bool("showVariant"),
    showVendor: bool("showVendor"),
    showBarcode: bool("showBarcode"),
    showProperties: bool("showProperties"),
    showPrices: bool("showPrices"),
    showCompareAt: bool("showCompareAt"),
    showTotals: bool("showTotals"),
    qtyFormat: pick("qtyFormat", ["of", "plain"] as const),
    itemsScope: pick("itemsScope", ["unfulfilled", "all"] as const),
    itemSort: pick("itemSort", ["order", "name", "sku"] as const),
    showCartAttributes: bool("showCartAttributes"),
    showDistance: bool("showDistance"),
    distanceUnit: pick(
      "distanceUnit",
      DISTANCE_UNITS.map((u) => u.id),
    ),
    distanceFrom:
      typeof r.distanceFrom === "string" && /^(order|\d{1,20})$/.test(r.distanceFrom)
        ? r.distanceFrom
        : d.distanceFrom,
    footerExtra: text("footerExtra"),
    accent:
      typeof r.accent === "string" && /^#[0-9a-f]{6}$/i.test(r.accent)
        ? r.accent
        : d.accent,
    // Older saves used "sans"/"serif"; map them onto the current list.
    font:
      r.font === "sans"
        ? "system"
        : r.font === "serif"
          ? "georgia"
          : pick("font", Object.keys(FONTS) as FontKey[]),
    fontSize: pick(
      "fontSize",
      FONT_SIZES.map((f) => f.id),
    ),
    labelSize: pick("labelSize", ["4x6", "4x4"] as const),
    language: isSlipLanguage(r.language) ? r.language : d.language,
    showBranding: bool("showBranding"),
    forecastRange: pick("forecastRange", ["all", "trip"] as const),
    showDispatch: bool("showDispatch"),
    maxDaysAhead: clampInt(r.maxDaysAhead, 0, 16, d.maxDaysAhead),
    skipWeekends: d.skipWeekends,
    showTip: bool("showTip"),
    // "qr_number" (order-number QR) was removed; it meant warehouse scanning.
    orderCode: r.orderCode === "qr_number" ? "barcode" : pick("orderCode", ["none", "qr", "barcode"] as const),
    watermark: pick("watermark", ["none", "text", "logo"] as const),
    watermarkText: text("watermarkText"),
    watermarkSize: pick("watermarkSize", ["S", "M", "L"] as const),
    watermarkAngle: pick("watermarkAngle", ["diagonal", "flat"] as const),
    watermarkOpacity: pick("watermarkOpacity", ["light", "medium", "strong"] as const),
  };
}

/**
 * The design as printed: the logo actually shown, from the chosen source.
 * `brandLogoUrl` is the cached store logo (Shop.brandLogoUrl).
 */
export function resolveLogo(
  d: SlipDesign,
  brandLogoUrl: string | null,
): SlipDesign {
  const url =
    d.logoSource === "store"
      ? brandLogoUrl
      : d.logoSource === "custom"
        ? d.logoUrl
        : null;
  return { ...d, logoUrl: url && isShopifyCdnUrl(url) ? url : null };
}

/** Merchant's slip settings (Shop row); the template is overridable per print. */
export interface SlipOptions {
  template: SlipTemplate;
  paper: PaperSize;
  showImages: boolean;
  showSku: boolean;
  showBilling: boolean;
  showNote: boolean;
  /** Replaces "Thank you for shopping with us!"; empty hides it. */
  footer: string | null;
  design: SlipDesign;
}

export const DEFAULT_SLIP_OPTIONS: SlipOptions = {
  template: "CLASSIC",
  paper: "A4",
  showImages: true,
  showSku: true,
  showBilling: true,
  showNote: true,
  footer: null,
  design: DEFAULT_SLIP_DESIGN,
};

export const isSlipTemplate = (v: unknown): v is SlipTemplate =>
  SLIP_TEMPLATES.some((t) => t.id === v);

export const FOOTER_MAX = 300;

function addressHtml(
  t: SlipStrings,
  a: PrintAddress | null,
  phoneFallback?: string | null,
  showPhone = true,
): string {
  if (!a) return `<p class="muted">${escapeHtml(t.noAddress)}</p>`;
  const lines = [
    a.name,
    a.company,
    a.address1,
    a.address2,
    [a.city, a.province, a.zip].filter(Boolean).join(" "),
    a.country,
  ].filter((l): l is string => Boolean(l && l.trim()));
  const phone = a.phone || phoneFallback;
  if (phone && showPhone) lines.push(`${t.phone}: ${phone}`);
  return lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("");
}

function placeText(w: {
  city: string | null;
  countryCode: string | null;
}): string {
  return [w.city, w.countryCode].filter(Boolean).join(", ");
}

function asOfText(iso: string, timeZone: string, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** The slip's wording and date/number locale, from the design's language. */
function lang(d: SlipDesign) {
  return { t: slipStrings(d.language), loc: slipLocale(d.language), cond: (label: string) => conditionLabel(label, d.language) };
}

function unavailableText(t: SlipStrings, status: Exclude<SlipWeather["status"], "ok">): string {
  return status === "limit_reached" ? t.limitReached : status === "no_location" ? t.noLocation : t.unavailable;
}

function forecastNotes(
  t: SlipStrings,
  loc: string,
  w: Extract<SlipWeather, { status: "ok" }>,
  d: SlipDesign,
): string[] {
  const end = shownEnd(w, d);
  if (w.delivery > end) {
    return [t.beyondRange(shortDay(w.delivery, loc), shortDay(end, loc))];
  }
  if (w.delivery < (w.days[0]?.date ?? w.delivery)) return [t.deliveryPassed];
  return [];
}

// Bad weather on a dispatch or delivery day gets a coloured warning badge:
// likely rain, a frost, or heat that can harm parcels left outside.
export const BAD_WEATHER = { rainPct: 60, freezingC: 0, hotC: 35 } as const;
export type WeatherWarning = "rain" | "freezing" | "hot";

export function weatherWarnings(day: Pick<SlipDay, "minC" | "maxC" | "precipProb">): WeatherWarning[] {
  const out: WeatherWarning[] = [];
  if (day.precipProb != null && day.precipProb >= BAD_WEATHER.rainPct) out.push("rain");
  if (day.minC <= BAD_WEATHER.freezingC) out.push("freezing");
  if (day.maxC >= BAD_WEATHER.hotC) out.push("hot");
  return out;
}

// Inline SVG (the print CSP allows no image hosts). Amber-to-red triangle
// with a white "!", so it stands out even on a mono laser as a dark shape.
const WARN_ICON = `<svg class="warn-ico" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.5 23 21.5H1z" fill="#F97316" stroke="#B91C1C" stroke-width="1.6" stroke-linejoin="round"/><rect x="10.8" y="8.5" width="2.4" height="7" rx="1.2" fill="#fff"/><circle cx="12" cy="18.3" r="1.35" fill="#fff"/></svg>`;

/** Warning badges for a key (dispatch/delivery) day; "" for any other day. */
function warningsHtml(t: SlipStrings, warnings: WeatherWarning[]): string {
  if (!warnings.length) return "";
  const text: Record<WeatherWarning, string> = { rain: t.warnRain, freezing: t.warnFreezing, hot: t.warnHot };
  return `<span class="warns">${warnings
    .map((w) => `<span class="warn w-${w}">${WARN_ICON}${escapeHtml(text[w])}</span>`)
    .join("")}</span>`;
}

const dayTags = (
  t: SlipStrings,
  w: { dispatch: string; delivery: string },
  date: string,
  d: SlipDesign,
) =>
  [
    d.showDispatch && date === w.dispatch ? t.dispatch : null,
    date === w.delivery ? t.delivery : null,
  ].filter((x): x is string => x != null);

/**
 * The days to show. "trip" keeps dispatch → delivery; if none of those are
 * in the forecast (dates passed or beyond the horizon) it shows them all
 * rather than an empty strip.
 */
function shownDays(w: Extract<SlipWeather, { status: "ok" }>, d: SlipDesign): SlipDay[] {
  const inPlan = planDays(w, d);
  if (d.forecastRange !== "trip") return inPlan;
  const trip = inPlan.filter((x) => x.date >= w.dispatch && x.date <= w.delivery);
  return trip.length ? trip : inPlan;
}

/**
 * The forecast days the plan includes: the fetch day + maxDaysAhead. With
 * weekdays only, weekend days are skipped and don't use up the plan's days
 * (unless one is the actual dispatch/delivery day, e.g. a carrier estimate).
 */
function planDays(w: Extract<SlipWeather, { status: "ok" }>, d: SlipDesign): SlipDay[] {
  const days = d.skipWeekends
    ? w.days.filter((x) => !isWeekend(x.date) || x.date === w.dispatch || x.date === w.delivery)
    : w.days;
  return days.slice(0, d.maxDaysAhead + 1);
}

/** Last date the slip may show — the plan's range, or the provider's if shorter. */
const shownEnd = (w: Extract<SlipWeather, { status: "ok" }>, d: SlipDesign) => {
  const last = planDays(w, d).at(-1)?.date;
  return last && last < w.horizonEnd ? last : w.horizonEnd;
};

/** "Rain expected on delivery day: …" — the worst of rain, frost, heat. */
export function weatherTip(
  t: SlipStrings,
  w: SlipWeather | undefined,
  d: SlipDesign = DEFAULT_SLIP_DESIGN,
): string | null {
  if (!w || w.status !== "ok") return null;
  // Only from days the plan shows — never hint at weather it doesn't include.
  const day = planDays(w, d).find((x) => x.date === w.delivery);
  if (!day) return null;
  const warns = weatherWarnings(day);
  if (warns.includes("rain")) return t.tipRain;
  if (warns.includes("freezing")) return t.tipFreezing;
  if (warns.includes("hot")) return t.tipHot;
  return null;
}

const tipHtml = (t: SlipStrings, w: SlipWeather | undefined, d: SlipDesign) => {
  const tip = d.showTip ? weatherTip(t, w, d) : null;
  return tip ? `<p class="tip">${WARN_ICON}<span>${escapeHtml(tip)}</span></p>` : "";
};

const DROP_ICON = `<svg class="drop" width="9" height="11" viewBox="0 0 9 11" aria-hidden="true" focusable="false"><path d="M4.5 0C3 2.4 0 5.2 0 7.2A4.5 3.8 0 0 0 9 7.2C9 5.2 6 2.4 4.5 0z" fill="#2F80ED"/></svg>`;

/**
 * The provider's licence requires visible attribution wherever its data is
 * shown (OpenWeather: ODbL, "Weather data © OpenWeather"). Printed with
 * every forecast on every plan — unlike the Weather Slip mark, it can't be
 * hidden.
 */
const WEATHER_CREDITS: Record<string, string> = {
  openweather: "OpenWeather",
  "open-meteo": "Open-Meteo.com",
};

export function weatherCredit(source: string): string {
  return `© ${WEATHER_CREDITS[source] ?? source}`;
}

function creditHtml(t: SlipStrings, w: Extract<SlipWeather, { status: "ok" }>): string {
  return `<p class="credit">${escapeHtml(t.weatherData)} ${escapeHtml(weatherCredit(w.source))}</p>`;
}

/** Forecast as cards (Classic, Detailed). */
function weatherCards(
  w: SlipWeather | undefined,
  unit: Unit,
  timeZone: string,
  d: SlipDesign = DEFAULT_SLIP_DESIGN,
): string {
  if (!w || (!d.showWeather && !d.showDates)) return "";
  const { t, loc, cond } = lang(d);
  const dates = d.showDates
    ? `
    <div class="dates">
      ${d.showDispatch ? `<p><strong>${escapeHtml(t.dispatch)}:</strong> ${escapeHtml(longDay(w.dispatch, loc))}</p>` : ""}
      <p><strong>${escapeHtml(t.estimatedDelivery)}:</strong> ${escapeHtml(longDay(w.delivery, loc))}</p>
    </div>`
    : "";
  if (!d.showWeather) return `<section class="weather">${dates}</section>`;
  if (w.status !== "ok") {
    return `<section class="weather">${dates}<p class="muted">${escapeHtml(unavailableText(t, w.status))}</p></section>`;
  }
  const boxes = shownDays(w, d)
    .map((day) => {
      const tags = dayTags(t, w, day.date, d);
      const rain =
        d.showRain && day.precipProb != null && day.precipProb >= 20
          ? `<div class="rain">${DROP_ICON} ${escapeHtml(t.rainPct(day.precipProb))}</div>`
          : "";
      const warns = tags.length ? weatherWarnings(day) : [];
      return `
        <div class="day${tags.length ? " key" : ""}${warns.length ? " bad" : ""}">
          <div class="d">${escapeHtml(shortDay(day.date, loc))}</div>
          ${tags.length ? `<div class="tag">${escapeHtml(tags.join(" · "))}</div>` : ""}
          ${warningsHtml(t, warns)}
          <div class="icon">${weatherIcon(day.label, 34)}</div>
          <div class="cond">${escapeHtml(cond(day.label))}</div>
          <div class="t">${escapeHtml(temp(day.maxC, unit))}</div>
          <div class="t lo">${escapeHtml(temp(day.minC, unit))}</div>
          ${rain}
        </div>`;
    })
    .join("");
  return `
    <section class="weather">
      ${dates}
      <h3>${escapeHtml(t.weatherForecast)} — ${escapeHtml(placeText(w) || t.destination)}</h3>
      ${d.showNow && w.current ? `<p class="now">${weatherIcon(w.current.label, 18)} ${escapeHtml(t.nowTitle)}: ${escapeHtml(temp(w.current.tempC, unit))}, ${escapeHtml(cond(w.current.label))}</p>` : ""}
      <div class="days">${boxes || `<p class="muted">${escapeHtml(t.noForecastDays)}</p>`}</div>
      ${tipHtml(t, w, d)}
      ${forecastNotes(t, loc, w, d)
        .map((n) => `<p class="muted">${escapeHtml(n)}</p>`)
        .join("")}
      ${d.showAsOf ? `<p class="asof">${escapeHtml(t.forecastAsOf)} ${escapeHtml(asOfText(w.asOf, timeZone, loc))}</p>` : ""}
      ${creditHtml(t, w)}
    </section>`;
}

/** Forecast as a compact table (Minimal, 4×6 label). */
function weatherTable(
  w: SlipWeather | undefined,
  unit: Unit,
  timeZone: string,
  compact: boolean,
  d: SlipDesign = DEFAULT_SLIP_DESIGN,
): string {
  if (!w || (!d.showWeather && !d.showDates)) return "";
  const { t, loc, cond } = lang(d);
  const dates = !d.showDates
    ? ""
    : compact
      ? `<p class="dates">${d.showDispatch ? `<strong>${escapeHtml(t.dispatch)}</strong> ${escapeHtml(shortDay(w.dispatch, loc))} · ` : ""}<strong>${escapeHtml(t.delivery)}</strong> ${escapeHtml(shortDay(w.delivery, loc))}</p>`
      : `<p class="dates">${d.showDispatch ? `<strong>${escapeHtml(t.dispatch)}:</strong> ${escapeHtml(longDay(w.dispatch, loc))} &nbsp; ` : ""}<strong>${escapeHtml(t.estimatedDelivery)}:</strong> ${escapeHtml(longDay(w.delivery, loc))}</p>`;
  if (!d.showWeather) return `<section class="weather">${dates}</section>`;
  if (w.status !== "ok") {
    return `<section class="weather">${dates}<p class="muted">${escapeHtml(unavailableText(t, w.status))}</p></section>`;
  }
  const rows = shownDays(w, d)
    .map((day) => {
      const tags = dayTags(t, w, day.date, d);
      const rain =
        day.precipProb != null && day.precipProb >= 20
          ? `${DROP_ICON} ${day.precipProb}%`
          : "";
      const warns = tags.length ? weatherWarnings(day) : [];
      return `<tr${tags.length ? ' class="key"' : ""}>
        <td>${escapeHtml(shortDay(day.date, loc))}${tags.length ? ` <span class="tag">${escapeHtml(tags.join("/"))}</span>` : ""}${warningsHtml(t, warns)}</td>
        <td class="wxcell">${weatherIcon(day.label, compact ? 14 : 16)} ${escapeHtml(cond(day.label))}</td>
        <td class="num">${escapeHtml(temp(day.maxC, unit))}</td>
        <td class="num">${escapeHtml(temp(day.minC, unit))}</td>
        ${d.showRain ? `<td class="num">${rain}</td>` : ""}
      </tr>`;
    })
    .join("");
  return `
    <section class="weather">
      ${dates}
      <h3>${escapeHtml(t.forecast)} — ${escapeHtml(placeText(w) || t.destination)}${d.showNow && w.current ? ` <span class="muted">(${escapeHtml(t.nowLower)} ${escapeHtml(temp(w.current.tempC, unit))}, ${escapeHtml(cond(w.current.label))})</span>` : ""}</h3>
      <table class="fc">
        <thead><tr><th>${escapeHtml(t.day)}</th><th>${escapeHtml(t.weather)}</th><th class="num">${escapeHtml(t.high)}</th><th class="num">${escapeHtml(t.low)}</th>${d.showRain ? `<th class="num">${escapeHtml(t.rain)}</th>` : ""}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${tipHtml(t, w, d)}
      ${forecastNotes(t, loc, w, d)
        .map((n) => `<p class="muted">${escapeHtml(n)}</p>`)
        .join("")}
      ${d.showAsOf ? `<p class="asof">${escapeHtml(t.forecastAsOf)} ${escapeHtml(asOfText(w.asOf, timeZone, loc))}</p>` : ""}
      ${creditHtml(t, w)}
    </section>`;
}

/**
 * The lines to print: what's still to ship (or every line, if chosen —
 * also the fallback for an order with nothing left to ship), sorted.
 */
function itemsToShip(order: PrintOrder, d: SlipDesign = DEFAULT_SLIP_DESIGN) {
  const all = order.lineItems.nodes;
  const open = all.filter((li) => li.unfulfilledQuantity > 0);
  const rows =
    d.itemsScope === "unfulfilled" && open.length
      ? open.map((li) => ({ li, qty: li.unfulfilledQuantity }))
      : all.map((li) => ({ li, qty: li.quantity }));
  if (d.itemSort === "name")
    rows.sort((a, b) => a.li.name.localeCompare(b.li.name));
  if (d.itemSort === "sku")
    rows.sort((a, b) => (a.li.sku ?? "￿").localeCompare(b.li.sku ?? "￿"));
  return rows;
}

function truncate(text: string, max: number): string {
  return max > 0 && text.length > max
    ? `${text.slice(0, max - 1).trimEnd()}…`
    : text;
}

/** Visible properties: Shopify hides keys starting with "_" at checkout too. */
const visibleAttrs = (
  attrs: { key: string; value: string | null }[] | undefined,
) => (attrs ?? []).filter((a) => a.value && !a.key.startsWith("_"));

/** Title line + detail lines for one item, per the design. */
function itemText(
  li: PrintOrder["lineItems"]["nodes"][number],
  d: SlipDesign,
  showSku: boolean,
) {
  const { t } = lang(d);
  const base = d.showVariant && li.title ? li.title : li.name;
  const details: string[] = [];
  if (d.showVariant && li.title && li.variantTitle)
    details.push(li.variantTitle);
  if (d.showVendor && li.vendor) details.push(`${t.vendor}: ${li.vendor}`);
  if (li.sku && showSku) details.push(`${t.sku}: ${li.sku}`);
  const barcode = li.variant?.barcodes?.nodes[0]?.value;
  if (d.showBarcode && barcode) details.push(`${t.barcode}: ${barcode}`);
  if (d.showProperties) {
    for (const a of visibleAttrs(li.customAttributes))
      details.push(`${a.key}: ${a.value}`);
  }
  return { title: truncate(base, d.titleMax), details };
}

function moneyFmt(currency: string | undefined, locale = "en-US") {
  const f = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency || "USD",
  });
  return (amount: string | number | undefined) =>
    amount == null ? "" : f.format(Number(amount));
}

const ITEM_IMG_PX: Record<SizeKey, number> = { S: 36, M: 48, L: 72 };

function itemsHtml(order: PrintOrder, o: SlipOptions, prices: boolean): string {
  const d = o.design;
  const { t, loc } = lang(d);
  // English keeps the US money format it always printed with.
  const money = moneyFmt(order.currencyCode, d.language === "en" ? "en-US" : loc);
  const lines = itemsToShip(order, d);
  // No image anywhere → no image column at all; a missing one leaves its
  // cell blank (no "No image" placeholder).
  const images = o.showImages && o.template !== "MINIMAL" && lines.some(({ li }) => li.image);
  const rows = lines
    .map(({ li, qty }) => {
      const img = li.image
        ? `<img src="${escapeHtml(li.image.url)}" alt="${escapeHtml(li.image.altText ?? "")}">`
        : "";
      const { title, details } = itemText(li, d, o.showSku);
      const original = Number(li.originalUnitPriceSet?.shopMoney.amount ?? NaN);
      const now = Number(
        li.discountedUnitPriceAfterAllDiscountsSet?.shopMoney.amount ??
          original,
      );
      const compare = Number(li.variant?.compareAtPrice ?? NaN);
      // Struck-through "was" price: the compare-at price, or the price
      // before an order discount — whichever is higher than what was paid.
      const was = Math.max(
        d.showCompareAt && compare > 0 ? compare : 0,
        original > now ? original : 0,
      );
      const priceCell = Number.isFinite(now)
        ? `${was > now ? `<s class="was">${escapeHtml(money(was))}</s> ` : ""}${escapeHtml(money(now))}`
        : "";
      return `
        <tr>
          ${images ? `<td class="img">${img}</td>` : ""}
          <td>
            <div class="iname">${escapeHtml(title)}</div>
            ${details.map((t) => `<div class="muted">${escapeHtml(t)}</div>`).join("")}
          </td>
          ${prices ? `<td class="num">${priceCell}</td>` : ""}
          <td class="qty">${d.qtyFormat === "of" ? escapeHtml(t.qtyOf(qty, li.quantity)) : qty}</td>
          ${prices ? `<td class="num">${Number.isFinite(now) ? escapeHtml(money(now * qty)) : ""}</td>` : ""}
        </tr>`;
    })
    .join("");
  return `
    <table class="items">
      <thead><tr>${images ? "<th></th>" : ""}<th>${escapeHtml(t.item)}</th>${prices ? `<th class="num">${escapeHtml(t.price)}</th>` : ""}<th class="qty">${escapeHtml(t.quantity)}</th>${prices ? `<th class="num">${escapeHtml(t.total)}</th>` : ""}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Cart attributes (gift message, delivery instructions…). */
function cartAttributesHtml(order: PrintOrder, d: SlipDesign): string {
  const attrs = d.showCartAttributes
    ? visibleAttrs(order.customAttributes)
    : [];
  if (!attrs.length) return "";
  return `<div class="note"><h3>${escapeHtml(lang(d).t.additionalDetails)}</h3>${attrs
    .map(
      (a) =>
        `<p><strong>${escapeHtml(a.key)}:</strong> ${escapeHtml(a.value)}</p>`,
    )
    .join("")}</div>`;
}

function totalsHtml(order: PrintOrder, d: SlipDesign): string {
  const { t, loc } = lang(d);
  const money = moneyFmt(order.currencyCode, d.language === "en" ? "en-US" : loc);
  const amt = (m?: { shopMoney: { amount: string } }) => m?.shopMoney.amount;
  const discount = Number(amt(order.currentTotalDiscountsSet) ?? 0);
  const lines: [string, string | undefined, boolean?][] = [
    [t.subtotal, amt(order.currentSubtotalPriceSet)],
    ...(discount > 0
      ? ([[t.discounts, `-${discount}`]] as [string, string][])
      : []),
    [t.shipping, amt(order.totalShippingPriceSet)],
    [t.tax, amt(order.currentTotalTaxSet)],
    [t.total, amt(order.currentTotalPriceSet), true],
  ];
  return `
    <table class="totals">
      ${lines
        .filter(([, v]) => v != null)
        .map(
          ([k, v, strong]) =>
            `<tr${strong ? ' class="grand"' : ""}><td>${escapeHtml(k)}</td><td class="num">${escapeHtml(money(v))}</td></tr>`,
        )
        .join("")}
    </table>`;
}

function thanks(o: SlipOptions): string {
  const msg =
    o.footer == null ? lang(o.design).t.thanks : o.footer.trim();
  return msg ? `<p class="thanks">${escapeHtml(msg)}</p>` : "";
}

function footerExtra(d: SlipDesign): string {
  return d.footerExtra
    ? `<p class="extra">${escapeHtml(d.footerExtra)}</p>`
    : "";
}

function shopFooter(shop: PrintShop, o: SlipOptions): string {
  const d = o.design;
  const a = shop.shopAddress;
  const lines = [
    ...(d.showStoreAddress
      ? [
          a?.address1,
          a?.address2,
          [a?.city, a?.province, a?.zip].filter(Boolean).join(" "),
          a?.country,
        ]
      : []),
    d.showStoreEmail ? shop.contactEmail : null,
    d.showStoreWebsite ? shop.primaryDomain?.host : null,
  ].filter((l): l is string => Boolean(l && l.trim()));
  const body = [
    thanks(o),
    d.showStoreName ? `<p><strong>${escapeHtml(shop.name)}</strong></p>` : "",
    lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(""),
    footerExtra(d),
  ].join("");
  return body.trim() ? `<footer>${body}</footer>` : "";
}

// Sizes come from CSS variables (designVars), never style="" attributes:
// the print page's CSP only allows its nonce'd stylesheet, so inline
// styles are silently dropped there (the preview isn't under that CSP,
// which is how a full-size logo got past it).
function logoHtml(d: SlipDesign): string {
  return d.logoUrl
    ? `<img class="logo" src="${escapeHtml(d.logoUrl)}" alt="">`
    : "";
}

const headerNote = (d: SlipDesign) =>
  d.headerNote ? `<div class="headnote">${escapeHtml(d.headerNote)}</div>` : "";

/** Email / payment lines under the addresses, when switched on. */
function contactHtml(order: PrintOrder, d: SlipDesign): string {
  const { t } = lang(d);
  const bits: string[] = [];
  if (d.showEmail && order.email)
    bits.push(
      `<span><strong>${escapeHtml(t.email)}:</strong> ${escapeHtml(order.email)}</span>`,
    );
  if (d.showPaymentStatus && order.displayFinancialStatus) {
    const p =
      t.paymentStatus[order.displayFinancialStatus] ??
      order.displayFinancialStatus;
    bits.push(`<span><strong>${escapeHtml(t.payment)}:</strong> ${escapeHtml(p)}</span>`);
  }
  return bits.length ? `<div class="contact">${bits.join("")}</div>` : "";
}

function itemCount(order: PrintOrder, d: SlipDesign): number {
  return itemsToShip(order, d).reduce((n, { qty }) => n + qty, 0);
}

const noteHtml = (order: PrintOrder, o: SlipOptions) =>
  o.showNote && order.note?.trim()
    ? `<div class="note"><h3>${escapeHtml(lang(o.design).t.orderNote)}</h3><p>${escapeHtml(order.note)}</p></div>`
    : "";

/** "Distance: 1,234 km from Austin, US" (one per shipping location). */
function distanceHtml(list: SlipDistance[] | undefined, d: SlipDesign): string {
  if (!d.showDistance || !list?.length) return "";
  const { t, loc } = lang(d);
  const ok = list.filter((x): x is Extract<SlipDistance, { status: "ok" }> => x.status === "ok");
  const body = ok.length
    ? ok
        .map((x) => `${escapeHtml(formatDistance(x.km, d.distanceUnit, d.language === "en" ? "en-US" : loc))}${x.from ? ` ${escapeHtml(t.from)} ${escapeHtml(x.from)}` : ""}`)
        .join(" · ")
    : `<span class="muted">${escapeHtml(t.notAvailable)}</span>`;
  return `<p class="distance"><strong>${escapeHtml(t.distance)}:</strong> ${body}${ok.length ? ` <span class="muted">(${escapeHtml(t.straightLine)})</span>` : ""}</p>`;
}

/**
 * Faint text or logo behind the slip. Sits in the page's own stacking
 * context (z-index -1 over the white page), so text stays on top. Logo =
 * the slip's resolved logo (Shopify CDN only, like the header logo).
 */
function watermarkHtml(d: SlipDesign): string {
  if (d.watermark === "logo" && d.logoUrl) {
    return `<div class="wm" aria-hidden="true"><img class="wm-logo" src="${escapeHtml(d.logoUrl)}" alt=""></div>`;
  }
  if (d.watermark === "text" && d.watermarkText?.trim()) {
    return `<div class="wm" aria-hidden="true"><span>${escapeHtml(d.watermarkText.trim())}</span></div>`;
  }
  return "";
}

interface PageCtx {
  shop: PrintShop;
  weather: SlipWeather | undefined;
  distance: SlipDistance[] | undefined;
  unit: Unit;
  timeZone: string;
  o: SlipOptions;
}

/** Classic, Minimal and Detailed share one full-page layout. */
function fullPage(order: PrintOrder, c: PageCtx): string {
  const { o } = c;
  const d = o.design;
  const { t, loc } = lang(d);
  const prices = o.template === "DETAILED" || d.showPrices;
  const totals = o.template === "DETAILED" || d.showTotals;
  const weather =
    o.template === "MINIMAL"
      ? weatherTable(c.weather, c.unit, c.timeZone, false, d)
      : weatherCards(c.weather, c.unit, c.timeZone, d);
  const title = escapeHtml(
    d.title ??
      (o.template === "DETAILED" ? t.packingSlipReceipt : t.packingSlip),
  );
  const logo = logoHtml(d);
  const meta = `
        <div class="meta">
          ${d.logoPosition === "right" ? logo : ""}
          ${orderCodeHtml(d, order, t, "div")}
          <p><strong>${escapeHtml(t.order)} ${escapeHtml(order.name)}</strong></p>
          ${d.showOrderDate ? `<p>${escapeHtml(longDate(order.createdAt, c.timeZone, loc))}</p>` : ""}
          ${d.showShippingMethod && order.shippingLine ? `<p>${escapeHtml(order.shippingLine.title)}</p>` : ""}
        </div>`;
  // Centred title: a 3-column header (left logo | title | order meta) so the
  // title sits in the middle of the page, not between logo and meta.
  const header = d.titleAlign === "center"
    ? `${d.logoPosition === "center" && logo ? `<div class="logo-center">${logo}</div>` : ""}<header class="title-center"><div class="brand">${d.logoPosition === "left" ? logo : ""}</div><h1>${title}</h1>${meta}</header>`
    : d.logoPosition === "center"
      ? `${logo ? `<div class="logo-center">${logo}</div>` : ""}<header><h1>${title}</h1>${meta}</header>`
      : d.logoPosition === "left"
        ? `<header><div class="brand">${logo}<h1>${title}</h1></div>${meta}</header>`
        : `<header><h1>${title}</h1>${meta}</header>`;
  return `
    <article class="page">
      ${watermarkHtml(d)}
      ${header}
      ${headerNote(d)}
      <div class="addresses">
        <div><h3>${escapeHtml(t.shipTo)}</h3>${addressHtml(t, order.shippingAddress, order.phone, d.showPhone)}</div>
        ${o.showBilling ? `<div><h3>${escapeHtml(t.billTo)}</h3>${addressHtml(t, order.billingAddress, null, d.showPhone)}</div>` : ""}
      </div>
      ${contactHtml(order, d)}
      ${distanceHtml(c.distance, d)}
      ${weather ? `<hr>${weather}` : ""}
      <hr>
      <h3>${escapeHtml(t.orderDetails)}${d.showItemCount ? ` · ${itemCount(order, d)} ${escapeHtml(t.items(itemCount(order, d)))}` : ""}</h3>
      ${itemsHtml(order, o, prices)}
      ${totals ? totalsHtml(order, d) : ""}
      ${noteHtml(order, o)}
      ${cartAttributesHtml(order, d)}
      ${shopFooter(c.shop, o)}
    </article>`;
}

/**
 * The scannable code in the header. A QR that opens the customer's order
 * status page gets a one-line caption, so the recipient knows to scan it.
 */
function orderCodeHtml(d: SlipDesign, order: PrintOrder, t: SlipStrings, tag: "div" | "span"): string {
  if (d.orderCode === "none") return "";
  const svg = orderCodeSvg(d.orderCode, order.name, order.statusPageUrl);
  if (!svg) return "";
  const link = svg.includes('class="ocode qr link"');
  const cap = link ? `<span class="ocode-cap">${escapeHtml(t.scanOrder)}</span>` : "";
  return `<${tag} class="ocode-wrap">${svg}${cap}</${tag}>`;
}

/** 4×6 in thermal label. */
function labelPage(order: PrintOrder, c: PageCtx): string {
  const items = itemsToShip(order, c.o.design)
    .map(({ li, qty }) => {
      const { title, details } = itemText(li, c.o.design, c.o.showSku);
      return `<li><span>${escapeHtml(title)}${details.length ? ` <span class="muted">(${escapeHtml(details.join(", "))})</span>` : ""}</span><strong>× ${qty}</strong></li>`;
    })
    .join("");
  const d = c.o.design;
  const { t, loc } = lang(d);
  // Label logo size comes from designVars (half the chosen height).
  const logo = logoHtml(d);
  return `
    <article class="page">
      ${watermarkHtml(d)}
      <header>
        <span class="brand">${logo}${d.showStoreName ? `<strong>${escapeHtml(c.shop.name)}</strong>` : ""}</span>
        <span>${orderCodeHtml(d, order, t, "span")}<strong>${escapeHtml(order.name)}</strong>${d.showOrderDate ? ` · ${escapeHtml(longDate(order.createdAt, c.timeZone, loc))}` : ""}</span>
      </header>
      ${headerNote(d)}
      <div class="shipto">
        <h3>${escapeHtml(t.shipTo)}</h3>
        ${addressHtml(t, order.shippingAddress, order.phone, d.showPhone)}
        ${d.showShippingMethod && order.shippingLine ? `<p class="muted">${escapeHtml(order.shippingLine.title)}</p>` : ""}
      </div>
      ${contactHtml(order, d)}
      ${distanceHtml(c.distance, d)}
      ${weatherTable(c.weather, c.unit, c.timeZone, true, d)}
      <h3>${escapeHtml(t.itemsHeading)}${d.showItemCount ? ` (${itemCount(order, d)})` : ""}</h3>
      <ul class="lines">${items}</ul>
      ${noteHtml(order, c.o)}
      ${cartAttributesHtml(order, d)}
      ${thanks(c.o)}
      ${footerExtra(d)}
    </article>`;
}

const BASE_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font: var(--fs, 12px)/1.45 var(--font, -apple-system, "Segoe UI", Arial, sans-serif); color: #111; background: #f3f3f3; }
  .bar { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; justify-content: space-between;
         padding: 10px 16px; background: #1a1a1a; color: #fff; font-size: 13px; z-index: 1; }
  .bar button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 0; background: #fff; color: #111; cursor: pointer; }
  .page { background: #fff; width: 100%; max-width: 210mm; margin: 16px auto; padding: 14mm 12mm;
          position: relative; isolation: isolate; }
  .page.fit-measure { margin: 0 !important; max-width: none !important; min-height: 0 !important; }
  .wm { position: absolute; inset: 0; z-index: -1; display: flex; align-items: center; justify-content: center;
        overflow: hidden; pointer-events: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .wm span { font-size: var(--wm-size, 72px); font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
             color: var(--accent, #111); opacity: var(--wm-op, .07); transform: rotate(var(--wm-rot, -30deg));
             white-space: nowrap; }
  .wm-logo { width: var(--wm-logo, 60%); max-height: 70%; object-fit: contain; opacity: var(--wm-op, .07);
             transform: rotate(var(--wm-rot, -30deg)); }
  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
  header h1 { font-size: 1.85em; color: var(--accent, #111); }
  header .brand { display: flex; align-items: center; gap: 12px; }
  header.title-center { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; }
  header.title-center h1 { text-align: center; }
  header.title-center .meta { justify-self: end; }
  .logo { display: block; object-fit: contain; height: auto; width: auto;
          max-height: var(--logo-h, 56px); max-width: var(--logo-w, 220px); }
  header .meta .logo { margin: 0 0 6px auto; }
  .logo-center { display: flex; justify-content: center; margin-bottom: 10px; }
  .headnote { border-left: 4px solid var(--accent, #111); background: #f6f6f6; padding: 8px 10px; margin: 0 0 12px; font-weight: 600; }
  footer .extra { margin-top: 8px; white-space: pre-wrap; color: #444; }
  .contact { display: flex; flex-wrap: wrap; gap: 6px 24px; margin: -4px 0 12px; }
  header .meta { text-align: right; }
  .addresses { display: flex; gap: 32px; margin-bottom: 12px; }
  .addresses > div { flex: 1; }
  h3 { font-size: 1em; margin-bottom: 6px; color: var(--accent, #111); }
  hr { border: 0; border-top: 1px solid var(--accent, #111); margin: 12px 0; }
  .muted { color: #666; }
  .num { text-align: right; white-space: nowrap; }
  .weather .dates { display: flex; gap: 24px; margin-bottom: 10px; }
  .weather .now { margin-bottom: 6px; }
  .days { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
  .day { border: 1px solid #bbb; border-radius: 4px; padding: 6px 8px; min-width: 92px; flex: 1 1 92px; }
  .day.key { border: 2px solid var(--accent, #111); }
  .day .d { font-weight: 600; }
  .day .tag, .fc .tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; color: var(--accent, #111); }
  .day .icon { margin: 4px 0 0; line-height: 0; }
  .day.bad { background: #FFF7ED; border-color: #EA580C; }
  .warns { display: inline-flex; flex-wrap: wrap; gap: 3px; margin: 2px 0; }
  .fc .warns { margin: 0 0 0 4px; vertical-align: middle; }
  .warn { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px 1px 3px; border-radius: 9px;
          font-size: 9.5px; font-weight: 700; line-height: 1.5; white-space: nowrap; border: 1px solid; }
  .warn svg.warn-ico { flex: none; }
  .warn.w-rain { background: #DBEAFE; color: #1E40AF; border-color: #3B82F6; }
  .warn.w-freezing { background: #CFFAFE; color: #155E75; border-color: #06B6D4; }
  .warn.w-hot { background: #FEE2E2; color: #991B1B; border-color: #EF4444; }
  /* Browsers drop backgrounds when printing unless told otherwise. */
  .day.bad, .warn { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .day .cond { color: #444; margin: 2px 0; }
  svg.wx { display: inline-block; vertical-align: middle; }
  .now svg.wx { margin: -3px 2px 0 0; }
  td.wxcell { white-space: nowrap; }
  td.wxcell svg.wx { margin: -2px 3px 0 0; }
  .day .lo, .day .rain { color: #555; font-size: 11px; }
  svg.drop { display: inline-block; vertical-align: -1px; }
  .tip { display: flex; align-items: center; gap: 6px; margin: 6px 0; padding: 5px 8px; border-left: 3px solid #EA580C;
         background: #FFF7ED; font-weight: 600; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .tip svg { flex: none; }
  .ocode-wrap { display: flex; flex-direction: column; align-items: flex-end; margin-bottom: 4px; }
  svg.ocode.qr { width: 64px; height: 64px; }
  /* A status-page link has ~3× the modules of an order number. */
  svg.ocode.qr.link { width: 96px; height: 96px; }
  .ocode-cap { font-size: 9px; color: #555; margin-top: 2px; }
  svg.ocode.bc { width: 150px; height: 34px; }
  table.fc { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  table.fc th { text-align: left; font-size: 10px; border-bottom: 1px solid #111; padding: 2px 4px; }
  table.fc td { border-bottom: 1px solid #ddd; padding: 3px 4px; }
  table.fc tr.key td { font-weight: 700; border-bottom: 1px solid var(--accent, #111); }
  table.fc .num { text-align: right; }
  .asof { color: #888; font-size: 10px; }
  .credit { color: #888; font-size: 9px; margin-top: 2px; }
  table.items { width: 100%; border-collapse: collapse; }
  table.items th { text-align: left; font-size: 11px; border-bottom: 1px solid #bbb; padding: 4px 6px; }
  table.items td { border-bottom: 1px solid #eee; padding: 6px; vertical-align: middle; }
  table.items .num { text-align: right; }
  td.img { width: calc(var(--img, 48px) + 8px); }
  td.img img { object-fit: contain; display: block; width: var(--img, 48px); height: var(--img, 48px); }
  .iname { font-weight: 500; }
  s.was { color: #888; }
  table.items .qty { text-align: right; white-space: nowrap; }
  table.totals { margin: 8px 0 0 auto; border-collapse: collapse; min-width: 220px; }
  table.totals td { padding: 3px 6px; }
  table.totals tr.grand td { font-weight: 700; border-top: 1px solid var(--accent, #111); }
  .note { margin-top: 12px; padding: 8px; border: 1px solid #ddd; background: #fafafa; }
  footer { margin-top: 24px; text-align: center; font-size: 11px; }
  .thanks { margin-bottom: 8px; }
  .distance { margin-top: 8px; }
  .ws-mark { display: none; position: fixed; left: 0; right: 0; justify-content: center; align-items: center;
             gap: 5px; font-size: 9px; color: #888; }
  .ws-mark svg { width: 14px; height: 14px; }
  table.list { width: 100%; border-collapse: collapse; }
  table.list th, table.list td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  table.list th { background: #f3f3f3; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .page { margin: 0; padding: 0; max-width: none; }
    /* Break before every slip but the first: a break after the last one
       (the mark and script follow it, so :last-child never matched)
       printed a blank extra page. */
    .page + .page { break-before: page; }
    .day, tr, li { break-inside: avoid; }
  }
`;

// Ink saver: hairlines and outlines only — no fills, no heavy borders.
const MINIMAL_STYLES = `
  header h1 { font-size: 1.6em; }
  .note { background: none; border: 1px solid #bbb; }
  hr { margin: 8px 0; border-top-color: #bbb; }
  .headnote { background: none; border-left-width: 2px; }
  table.items td { border-bottom: 1px solid #ccc; padding: 4px 6px; }
  table.fc th { border-bottom: 1px solid #999; }
  table.fc tr.key td { border-bottom: 1px solid #999; }
  table.fc tr.key td:first-child { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
  .warn { background: none !important; }
  .tip { background: none; border-left-width: 2px; }
`;

const LABEL_STYLES = `
  body { line-height: 1.3; }
  .page { width: 4in; max-width: 4in; min-height: 6in; padding: 0.15in; }
  header { border-bottom: 2px solid #111; padding-bottom: 4px; margin-bottom: 6px; font-size: 10px; gap: 8px; }
  .shipto { border: 2px solid #111; padding: 6px 8px; margin-bottom: 6px; font-size: 13px; line-height: 1.3; }
  .shipto h3 { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }
  .shipto p:first-of-type { font-weight: 700; font-size: 15px; }
  .weather .dates { display: block; margin-bottom: 4px; }
  h3 { font-size: 10px; margin: 6px 0 3px; }
  table.fc th, table.fc td { padding: 1px 3px; font-size: 9px; }
  .asof { font-size: 8px; }
  .credit { font-size: 7px; }
  ul.lines { list-style: none; }
  ul.lines li { display: flex; justify-content: space-between; gap: 8px; border-bottom: 1px dotted #999; padding: 2px 0; }
  .note { margin-top: 6px; padding: 4px; background: none; border: 1px solid #111; }
  .thanks { margin-top: 6px; text-align: center; font-size: 9px; }
  .distance { margin: 4px 0; }
  .tip { padding: 3px 5px; font-size: 9px; }
  header .ocode-wrap { display: inline-flex; vertical-align: middle; margin: 0 6px 0 0; }
  svg.ocode.qr { width: 48px; height: 48px; }
  svg.ocode.qr.link { width: 72px; height: 72px; }
  header .ocode-wrap { flex-direction: column; align-items: center; }
  .ocode-cap { font-size: 7px; }
  svg.ocode.bc { width: 120px; height: 28px; }
  @page { size: 4in 6in; margin: 0; }
  @media print { .page { padding: 0.15in; width: 4in; } }
`;

function pageRule(o: SlipOptions): string {
  if (o.template === "LABEL_4X6") {
    // Label stylesheet is 4×6; a 4×4 label only changes the height.
    return o.design.labelSize === "4x4"
      ? "@page { size: 4in 4in; margin: 0; } .page { min-height: 4in; }"
      : "";
  }
  const p = PAPER_SIZES.find((x) => x.id === o.paper) ?? PAPER_SIZES[0]!;
  return `@page { size: ${p.css}; margin: 0; }
    .page { max-width: ${p.maxWidth}; }
    ${printMargin(p.id === "A5" ? "7mm" : "10mm")}`;
}

/**
 * Browsers print their own header/footer (date, title, URL, page number)
 * inside the @page margin, so the page margin is 0 and the white space
 * lives on .page instead (cloned onto every printed page). The bottom
 * keeps room for the Weather Slip mark.
 */
function printMargin(m: string): string {
  return `@media print {
    .page { padding: ${m} ${m} calc(${m} + 8mm);
            box-decoration-break: clone; -webkit-box-decoration-break: clone; }
    .ws-mark { display: flex; bottom: calc(${m} - 2mm); }
  }
  .page.fit-measure { padding: ${m} ${m} calc(${m} + 8mm); }`;
}

/** The printed sheet in CSS px for these options (see FIT_SCRIPT). */
function sheetPx(o: SlipOptions): [number, number] {
  if (o.template === "LABEL_4X6") return o.design.labelSize === "4x4" ? [384, 384] : [384, 576];
  return (PAPER_SIZES.find((x) => x.id === o.paper) ?? PAPER_SIZES[0]!).px;
}

/**
 * A slip a little taller than its sheet spilled a few lines (footer, mark,
 * gift message) onto a second page. Before printing, each .page is laid out
 * at the sheet's width with its print padding (.fit-measure) and measured;
 * if it overflows by up to 40% it's zoomed to fit one sheet (laid out
 * wider by 1/zoom so it still fills the width). Longer slips (many items)
 * keep flowing onto more pages. CSSOM styles are allowed under the nonce
 * CSP; style="" in markup is not.
 */
const FIT_SCRIPT = `(function () {
  var b = document.body, W = +b.getAttribute("data-sheet-w"), H = +b.getAttribute("data-sheet-h");
  if (!W || !H) return;
  function fit() {
    var pages = document.querySelectorAll(".page");
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i];
      p.style.zoom = ""; p.style.maxWidth = "";
      p.classList.add("fit-measure"); p.style.width = W + "px";
      var h = p.scrollHeight;
      p.classList.remove("fit-measure"); p.style.width = "";
      if (h <= H - 2) continue;
      var z = (H - 6) / h;
      if (z < 0.6) continue;
      p.style.maxWidth = "none"; p.style.width = (W / z) + "px"; p.style.zoom = String(z);
    }
  }
  window.__fitPages = fit;
  if (document.readyState === "complete") fit(); else window.addEventListener("load", fit);
  window.addEventListener("beforeprint", fit);
})();`;

/** The merchant's look, as CSS variables the base styles read. */
function designVars(d: SlipDesign, label: boolean): string {
  const base = FONT_SIZES.find((f) => f.id === d.fontSize)?.px ?? 12;
  const px = label ? base - 2 : base;
  // A 4-inch label has less room: half the chosen logo size, 16–48 px.
  const logoH = label ? Math.min(48, Math.max(16, Math.round(d.logoHeight / 2))) : d.logoHeight;
  const logoW = label ? Math.min(160, d.logoMaxWidth) : d.logoMaxWidth;
  const img = ITEM_IMG_PX[d.itemImageSize];
  // Watermark: labels are 4 in wide, so everything scales down there.
  const wmText = { S: 48, M: 72, L: 104 }[d.watermarkSize] * (label ? 0.5 : 1);
  const wmLogo = { S: 40, M: 60, L: 80 }[d.watermarkSize];
  const wmOp = { light: 0.07, medium: 0.12, strong: 0.2 }[d.watermarkOpacity];
  const wmRot = d.watermarkAngle === "flat" ? 0 : -30;
  return `:root { --accent: ${d.accent}; --font: ${FONTS[d.font].css}; --fs: ${px}px; --logo-h: ${logoH}px; --logo-w: ${logoW}px; --img: ${img}px; --wm-size: ${wmText}px; --wm-logo: ${wmLogo}%; --wm-op: ${wmOp}; --wm-rot: ${wmRot}deg; }`;
}

function stylesFor(o: SlipOptions | null): string {
  if (!o) return BASE_STYLES + "@page { margin: 0; }" + printMargin("10mm");
  return (
    designVars(o.design, o.template === "LABEL_4X6") +
    BASE_STYLES +
    (o.template === "MINIMAL" ? MINIMAL_STYLES : "") +
    (o.template === "LABEL_4X6" ? LABEL_STYLES : "") +
    pageRule(o)
  );
}

interface DocOptions {
  nonce: string;
  autoPrint: boolean;
  /** false: no toolbar or script (in-app preview). */
  chrome: boolean;
  /** The Weather Slip mark at the foot of each page. */
  mark: boolean;
  /** <html lang>, so the browser hyphenates and reads it right. */
  lang: string;
  /** Shown in the toolbar only (never printed), e.g. orders skipped by plan. */
  notice?: string;
  /** Sheet size in CSS px: slips slightly taller than it are fitted to one page. */
  sheet?: [number, number];
}

/** Printed at the foot of every page (in place of the browser's URL line). */
const WS_MARK = `<div class="ws-mark"><svg viewBox="0 0 64 64" aria-hidden="true">
  <defs><linearGradient id="ws-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3FA0F7"/><stop offset="1" stop-color="#1452A8"/></linearGradient></defs>
  <rect width="64" height="64" rx="14" fill="url(#ws-sky)"/>
  <rect x="14" y="16" width="30" height="38" rx="4" fill="#FFFFFF"/>
  <rect x="19" y="24" width="14" height="4" rx="2" fill="#9BC1F1"/>
  <rect x="19" y="33" width="20" height="10" rx="3" fill="#1F6FDB"/>
  <rect x="19" y="46" width="16" height="4" rx="2" fill="#9BC1F1"/>
  <circle cx="46" cy="17" r="10" fill="#FFB12A" stroke="#1E63C4" stroke-width="2.5"/>
</svg><span>Weather Slip</span></div>`;

function documentHtml(
  title: string,
  body: string,
  styles: string,
  d: DocOptions,
): string {
  // Fit runs in Shopify's print preview too (no toolbar there); the in-app
  // preview iframe is sandboxed without scripts, so it never runs there.
  const fit = d.sheet ? FIT_SCRIPT : "";
  const toolbar = d.chrome
    ? `document.getElementById("print").addEventListener("click", function () { window.print(); });
  ${d.autoPrint ? `window.addEventListener("load", function () { setTimeout(function () { if (window.__fitPages) window.__fitPages(); window.print(); }, 300); });` : ""}`
    : "";
  const script = fit || toolbar ? `<script nonce="${d.nonce}">${fit}\n${toolbar}</script>` : "";
  return `<!doctype html>
<html lang="${d.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style nonce="${d.nonce}">${styles}</style>
</head>
<body${d.sheet ? ` data-sheet-w="${d.sheet[0]}" data-sheet-h="${d.sheet[1]}"` : ""}>
${d.chrome ? `<div class="bar"><span>${escapeHtml(title)}${d.notice ? ` — <em>${escapeHtml(d.notice)}</em>` : ""}</span><button type="button" id="print">Print / Save as PDF</button></div>` : ""}
${body}
${d.mark ? WS_MARK : ""}
${script}
</body>
</html>`;
}

export interface SlipRenderOptions {
  unit: Unit;
  timeZone: string;
  nonce: string;
  autoPrint?: boolean;
  chrome?: boolean;
  slip?: SlipOptions;
  /** Keyed by numeric order ID; only read when design.showDistance. */
  distance?: Map<string, SlipDistance[]>;
  /** Toolbar-only note (orders skipped by the plan). */
  notice?: string;
}

export function renderPackingSlips(
  shop: PrintShop,
  orders: PrintOrder[],
  weather: Map<string, SlipWeather>,
  opts: SlipRenderOptions,
): string {
  const o = opts.slip ?? DEFAULT_SLIP_OPTIONS;
  const pages = orders
    .map((order) => {
      const id = order.id.slice(order.id.lastIndexOf("/") + 1);
      const ctx: PageCtx = {
        shop,
        weather: weather.get(id),
        distance: opts.distance?.get(id),
        unit: opts.unit,
        timeZone: opts.timeZone,
        o,
      };
      return o.template === "LABEL_4X6"
        ? labelPage(order, ctx)
        : fullPage(order, ctx);
    })
    .join("");
  const title =
    orders.length === 1
      ? `Packing slip ${orders[0]!.name}`
      : `Packing slips (${orders.length})`;
  return documentHtml(title, pages, stylesFor(o), {
    nonce: opts.nonce,
    autoPrint: opts.autoPrint ?? true,
    chrome: opts.chrome ?? true,
    mark: o.design.showBranding,
    lang: o.design.language,
    notice: opts.notice,
    sheet: sheetPx(o),
  });
}

export function renderCustomerList(
  shop: PrintShop,
  orders: PrintOrder[],
  opts: Omit<SlipRenderOptions, "unit" | "slip"> & { mark?: boolean },
): string {
  const rows = orders
    .map((o, i) => {
      const a = o.shippingAddress;
      const customer = a?.name || o.billingAddress?.name || "";
      const dest = a
        ? [a.city, a.provinceCode, a.countryCodeV2].filter(Boolean).join(", ")
        : "";
      const items = o.lineItems.nodes.reduce(
        (n, li) => n + li.unfulfilledQuantity,
        0,
      );
      return `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(o.name)}</td>
          <td>${escapeHtml(customer)}</td>
          <td>${escapeHtml(dest)}</td>
          <td>${items}</td>
          <td>${escapeHtml(o.shippingLine?.title ?? "")}</td>
        </tr>`;
    })
    .join("");
  const generated = longDate(new Date().toISOString(), opts.timeZone);
  const body = `
    <article class="page">
      <header>
        <h1>Customer list</h1>
        <div class="meta"><p>${escapeHtml(shop.name)}</p><p>${orders.length} orders · ${escapeHtml(generated)}</p></div>
      </header>
      <table class="list">
        <thead><tr><th>#</th><th>Order</th><th>Customer</th><th>Destination</th><th>Items to ship</th><th>Shipping</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </article>`;
  return documentHtml(
    `Customer list (${orders.length})`,
    body,
    stylesFor(null),
    {
      nonce: opts.nonce,
      autoPrint: opts.autoPrint ?? true,
      chrome: opts.chrome ?? true,
      mark: opts.mark ?? true,
      lang: "en",
      notice: opts.notice,
    },
  );
}
