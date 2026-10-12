// Printable packing slips and the customer list, rendered as one plain HTML
// document per print run. The browser prints it (or saves it as PDF), so
// there's no headless Chrome to run on Vercel. Pure: no server imports, so
// it's unit-tested directly.
import { addDays, shortDay, type IsoDate } from "./dates";
import { cToF, type Unit } from "./format";
import { weatherIcon } from "./weather-icons";
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
    })
  | (SlipBase & { status: "no_location" | "limit_reached" | "error" });

/** Every forecast day from today at the destination through the horizon. */
export function slipForecast(
  forecast: ForecastPayload,
  today: IsoDate,
  horizonDays: number,
): { current: { tempC: number; label: string } | null; days: SlipDay[]; horizonEnd: IsoDate } {
  const horizonEnd = addDays(today, horizonDays);
  const days = forecast.daily
    .filter((d) => d.date >= today && d.date <= horizonEnd)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, minC, maxC, precipProb, label }) => ({ date, minC, maxC, precipProb, label }));
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

function longDate(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
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
function longDay(date: IsoDate): string {
  return new Intl.DateTimeFormat("en-GB", {
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

export const PAPER_SIZES: { id: PaperSize; label: string; css: string; maxWidth: string }[] = [
  { id: "A4", label: "A4 (210 × 297 mm)", css: "A4", maxWidth: "210mm" },
  { id: "A5", label: "A5 (148 × 210 mm)", css: "A5", maxWidth: "148mm" },
  { id: "LETTER", label: "US Letter (8.5 × 11 in)", css: "letter", maxWidth: "8.5in" },
  { id: "LEGAL", label: "US Legal (8.5 × 14 in)", css: "legal", maxWidth: "8.5in" },
];

export const SLIP_TEMPLATES: { id: SlipTemplate; name: string; description: string }[] = [
  {
    id: "CLASSIC",
    name: "Classic",
    description: "Full page: addresses, forecast cards, product images, store footer.",
  },
  {
    id: "MINIMAL",
    name: "Minimal",
    description: "Ink saver: no images or shading, forecast as a compact table.",
  },
  {
    id: "DETAILED",
    name: "Detailed",
    description: "Classic plus prices, line totals and order totals — doubles as a receipt.",
  },
  {
    id: "LABEL_4X6",
    name: "Shipping label",
    description: "For thermal label printers: big ship-to address, forecast and items on a 4×6 or 4×4 in label.",
  },
];

export type LogoPosition = "left" | "center" | "right";
export type SizeKey = "S" | "M" | "L";
export type FontSizeKey = "XS" | "S" | "M" | "L" | "XL";
export type LabelSize = "4x6" | "4x4";

// System font stacks only: the print page's CSP loads nothing external.
export const FONTS = {
  system: { label: "System sans-serif (default)", css: '-apple-system, "Segoe UI", Arial, sans-serif' },
  helvetica: { label: "Helvetica / Arial", css: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  verdana: { label: "Verdana (wide, very legible)", css: "Verdana, Geneva, sans-serif" },
  trebuchet: { label: "Trebuchet", css: '"Trebuchet MS", "Lucida Grande", sans-serif' },
  georgia: { label: "Georgia (serif)", css: "Georgia, Cambria, serif" },
  times: { label: "Times New Roman (serif)", css: '"Times New Roman", Times, serif' },
  garamond: { label: "Garamond (elegant serif)", css: 'Garamond, "EB Garamond", Baskerville, serif' },
  courier: { label: "Courier (typewriter)", css: '"Courier New", Courier, monospace' },
  mono: { label: "Monospace (receipt)", css: '"SFMono-Regular", Menlo, Consolas, monospace' },
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
export interface SlipDesign {
  /** https://cdn.shopify.com/… only — the print page's CSP allows no other image host. */
  logoUrl: string | null;
  logoPosition: LogoPosition;
  logoSize: SizeKey;
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
  /** Extra footer text (returns policy, care notes); line breaks kept. */
  footerExtra: string | null;
  accent: string; // #rrggbb
  font: FontKey;
  fontSize: FontSizeKey;
  labelSize: LabelSize;
}

export const DEFAULT_SLIP_DESIGN: SlipDesign = {
  logoUrl: null,
  logoPosition: "left",
  logoSize: "M",
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
  footerExtra: null,
  accent: "#111111",
  font: "system",
  fontSize: "M",
  labelSize: "4x6",
};

export const TEXT_MAX = { title: 60, headerNote: 200, footerExtra: 600 } as const;

export const isShopifyCdnUrl = (v: string) =>
  /^https:\/\/cdn\.shopify\.com\/[^\s"'<>]{1,480}$/.test(v);

/** Coerce anything (stored JSON, a request body) into a valid design. */
export function sanitizeDesign(raw: unknown): SlipDesign {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SLIP_DESIGN;
  const bool = (k: keyof SlipDesign) => (typeof r[k] === "boolean" ? (r[k] as boolean) : (d[k] as boolean));
  const pick = <T extends string>(k: keyof SlipDesign, allowed: readonly T[]): T =>
    allowed.includes(r[k] as T) ? (r[k] as T) : (d[k] as T);
  const text = (k: keyof typeof TEXT_MAX) => {
    const v = r[k];
    if (typeof v !== "string") return d[k] as string | null;
    const t = v.slice(0, TEXT_MAX[k]);
    return t.trim() ? t : null;
  };
  const logo = typeof r.logoUrl === "string" ? r.logoUrl.trim() : "";
  return {
    logoUrl: logo && isShopifyCdnUrl(logo) ? logo : null,
    logoPosition: pick("logoPosition", ["left", "center", "right"] as const),
    logoSize: pick("logoSize", ["S", "M", "L"] as const),
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
    footerExtra: text("footerExtra"),
    accent: typeof r.accent === "string" && /^#[0-9a-f]{6}$/i.test(r.accent) ? r.accent : d.accent,
    // Older saves used "sans"/"serif"; map them onto the current list.
    font: r.font === "sans" ? "system" : r.font === "serif" ? "georgia" : pick("font", Object.keys(FONTS) as FontKey[]),
    fontSize: pick("fontSize", FONT_SIZES.map((f) => f.id)),
    labelSize: pick("labelSize", ["4x6", "4x4"] as const),
  };
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
  a: PrintAddress | null,
  phoneFallback?: string | null,
  showPhone = true,
): string {
  if (!a) return `<p class="muted">No address</p>`;
  const lines = [
    a.name,
    a.company,
    a.address1,
    a.address2,
    [a.city, a.province, a.zip].filter(Boolean).join(" "),
    a.country,
  ].filter((l): l is string => Boolean(l && l.trim()));
  const phone = a.phone || phoneFallback;
  if (phone && showPhone) lines.push(`Phone: ${phone}`);
  return lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("");
}

function placeText(w: { city: string | null; countryCode: string | null }): string {
  return [w.city, w.countryCode].filter(Boolean).join(", ");
}

function asOfText(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function unavailableText(status: Exclude<SlipWeather["status"], "ok">): string {
  return status === "limit_reached"
    ? "Weather not included: this month's plan limit is reached."
    : status === "no_location"
      ? "Weather not available: no shipping destination."
      : "Weather temporarily unavailable.";
}

function forecastNotes(w: Extract<SlipWeather, { status: "ok" }>): string[] {
  if (w.delivery > w.horizonEnd) {
    return [
      `Delivery day (${shortDay(w.delivery)}) is beyond the forecast range (to ${shortDay(w.horizonEnd)}).`,
    ];
  }
  if (w.delivery < (w.days[0]?.date ?? w.delivery)) return ["Estimated delivery date has passed."];
  return [];
}

const dayTags = (w: { dispatch: string; delivery: string }, date: string) =>
  [date === w.dispatch ? "Dispatch" : null, date === w.delivery ? "Delivery" : null].filter(
    (t): t is string => t != null,
  );

/** Forecast as cards (Classic, Detailed). */
function weatherCards(
  w: SlipWeather | undefined,
  unit: Unit,
  timeZone: string,
  d: SlipDesign = DEFAULT_SLIP_DESIGN,
): string {
  if (!w || (!d.showWeather && !d.showDates)) return "";
  const dates = d.showDates
    ? `
    <div class="dates">
      <p><strong>Dispatch:</strong> ${escapeHtml(longDay(w.dispatch))}</p>
      <p><strong>Estimated delivery:</strong> ${escapeHtml(longDay(w.delivery))}</p>
    </div>`
    : "";
  if (!d.showWeather) return `<section class="weather">${dates}</section>`;
  if (w.status !== "ok") {
    return `<section class="weather">${dates}<p class="muted">${escapeHtml(unavailableText(w.status))}</p></section>`;
  }
  const boxes = w.days
    .map((day) => {
      const tags = dayTags(w, day.date);
      const rain =
        d.showRain && day.precipProb != null && day.precipProb >= 20
          ? `<div class="rain">${day.precipProb}% rain</div>`
          : "";
      return `
        <div class="day${tags.length ? " key" : ""}">
          <div class="d">${escapeHtml(shortDay(day.date))}</div>
          ${tags.length ? `<div class="tag">${escapeHtml(tags.join(" · "))}</div>` : ""}
          <div class="icon">${weatherIcon(day.label, 34)}</div>
          <div class="cond">${escapeHtml(day.label)}</div>
          <div class="t">${escapeHtml(temp(day.maxC, unit))}</div>
          <div class="t lo">${escapeHtml(temp(day.minC, unit))}</div>
          ${rain}
        </div>`;
    })
    .join("");
  return `
    <section class="weather">
      ${dates}
      <h3>Weather forecast — ${escapeHtml(placeText(w) || "destination")}</h3>
      ${d.showNow && w.current ? `<p class="now">${weatherIcon(w.current.label, 18)} Now: ${escapeHtml(temp(w.current.tempC, unit))}, ${escapeHtml(w.current.label)}</p>` : ""}
      <div class="days">${boxes || `<p class="muted">No forecast days available.</p>`}</div>
      ${forecastNotes(w).map((n) => `<p class="muted">${escapeHtml(n)}</p>`).join("")}
      ${d.showAsOf ? `<p class="asof">Forecast as of ${escapeHtml(asOfText(w.asOf, timeZone))}</p>` : ""}
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
  const dates = !d.showDates
    ? ""
    : compact
      ? `<p class="dates"><strong>Dispatch</strong> ${escapeHtml(shortDay(w.dispatch))} · <strong>Delivery</strong> ${escapeHtml(shortDay(w.delivery))}</p>`
      : `<p class="dates"><strong>Dispatch:</strong> ${escapeHtml(longDay(w.dispatch))} &nbsp; <strong>Estimated delivery:</strong> ${escapeHtml(longDay(w.delivery))}</p>`;
  if (!d.showWeather) return `<section class="weather">${dates}</section>`;
  if (w.status !== "ok") {
    return `<section class="weather">${dates}<p class="muted">${escapeHtml(unavailableText(w.status))}</p></section>`;
  }
  const rows = w.days
    .map((day) => {
      const tags = dayTags(w, day.date);
      const rain = day.precipProb != null && day.precipProb >= 20 ? `${day.precipProb}%` : "";
      return `<tr${tags.length ? ' class="key"' : ""}>
        <td>${escapeHtml(shortDay(day.date))}${tags.length ? ` <span class="tag">${escapeHtml(tags.join("/"))}</span>` : ""}</td>
        <td class="wxcell">${weatherIcon(day.label, compact ? 14 : 16)} ${escapeHtml(day.label)}</td>
        <td class="num">${escapeHtml(temp(day.maxC, unit))}</td>
        <td class="num">${escapeHtml(temp(day.minC, unit))}</td>
        ${d.showRain ? `<td class="num">${rain}</td>` : ""}
      </tr>`;
    })
    .join("");
  return `
    <section class="weather">
      ${dates}
      <h3>Forecast — ${escapeHtml(placeText(w) || "destination")}${d.showNow && w.current ? ` <span class="muted">(now ${escapeHtml(temp(w.current.tempC, unit))}, ${escapeHtml(w.current.label)})</span>` : ""}</h3>
      <table class="fc">
        <thead><tr><th>Day</th><th>Weather</th><th class="num">High</th><th class="num">Low</th>${d.showRain ? '<th class="num">Rain</th>' : ""}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${forecastNotes(w).map((n) => `<p class="muted">${escapeHtml(n)}</p>`).join("")}
      ${d.showAsOf ? `<p class="asof">Forecast as of ${escapeHtml(asOfText(w.asOf, timeZone))}</p>` : ""}
    </section>`;
}

function itemsToShip(order: PrintOrder) {
  const all = order.lineItems.nodes;
  const open = all.filter((li) => li.unfulfilledQuantity > 0);
  return open.length
    ? open.map((li) => ({ li, qty: li.unfulfilledQuantity }))
    : all.map((li) => ({ li, qty: li.quantity }));
}

function moneyFmt(currency: string | undefined) {
  const f = new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" });
  return (amount: string | number | undefined) => (amount == null ? "" : f.format(Number(amount)));
}

function itemsHtml(order: PrintOrder, o: SlipOptions, prices: boolean): string {
  const money = moneyFmt(order.currencyCode);
  const images = o.showImages && o.template !== "MINIMAL";
  const rows = itemsToShip(order)
    .map(({ li, qty }) => {
      const img = li.image
        ? `<img src="${escapeHtml(li.image.url)}" alt="${escapeHtml(li.image.altText ?? "")}">`
        : `<span class="noimg">No image</span>`;
      const unit = li.originalUnitPriceSet?.shopMoney.amount;
      return `
        <tr>
          ${images ? `<td class="img">${img}</td>` : ""}
          <td>
            <div>${escapeHtml(li.name)}</div>
            ${o.showSku && li.sku ? `<div class="muted">SKU: ${escapeHtml(li.sku)}</div>` : ""}
          </td>
          ${prices ? `<td class="num">${escapeHtml(money(unit))}</td>` : ""}
          <td class="qty">${qty} of ${li.quantity}</td>
          ${prices ? `<td class="num">${unit != null ? escapeHtml(money(Number(unit) * qty)) : ""}</td>` : ""}
        </tr>`;
    })
    .join("");
  return `
    <table class="items">
      <thead><tr>${images ? "<th></th>" : ""}<th>Item</th>${prices ? '<th class="num">Price</th>' : ""}<th class="qty">Quantity</th>${prices ? '<th class="num">Total</th>' : ""}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function totalsHtml(order: PrintOrder): string {
  const money = moneyFmt(order.currencyCode);
  const amt = (m?: { shopMoney: { amount: string } }) => m?.shopMoney.amount;
  const discount = Number(amt(order.currentTotalDiscountsSet) ?? 0);
  const lines: [string, string | undefined, boolean?][] = [
    ["Subtotal", amt(order.currentSubtotalPriceSet)],
    ...(discount > 0 ? ([["Discounts", `-${discount}`]] as [string, string][]) : []),
    ["Shipping", amt(order.totalShippingPriceSet)],
    ["Tax", amt(order.currentTotalTaxSet)],
    ["Total", amt(order.currentTotalPriceSet), true],
  ];
  return `
    <table class="totals">
      ${lines
        .filter(([, v]) => v != null)
        .map(
          ([k, v, strong]) =>
            `<tr${strong ? ' class="grand"' : ""}><td>${k}</td><td class="num">${escapeHtml(money(v))}</td></tr>`,
        )
        .join("")}
    </table>`;
}

function thanks(o: SlipOptions): string {
  const msg = o.footer == null ? "Thank you for shopping with us!" : o.footer.trim();
  return msg ? `<p class="thanks">${escapeHtml(msg)}</p>` : "";
}

function footerExtra(d: SlipDesign): string {
  return d.footerExtra ? `<p class="extra">${escapeHtml(d.footerExtra)}</p>` : "";
}

function shopFooter(shop: PrintShop, o: SlipOptions): string {
  const d = o.design;
  const a = shop.shopAddress;
  const lines = [
    ...(d.showStoreAddress
      ? [a?.address1, a?.address2, [a?.city, a?.province, a?.zip].filter(Boolean).join(" "), a?.country]
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

const LOGO_PX: Record<SizeKey, number> = { S: 36, M: 56, L: 80 };

function logoHtml(d: SlipDesign, px = LOGO_PX[d.logoSize]): string {
  return d.logoUrl
    ? `<img class="logo" src="${escapeHtml(d.logoUrl)}" alt="" style="max-height:${px}px">`
    : "";
}

const headerNote = (d: SlipDesign) =>
  d.headerNote ? `<div class="headnote">${escapeHtml(d.headerNote)}</div>` : "";

const PAYMENT_LABEL: Record<string, string> = {
  PAID: "Paid",
  PENDING: "Payment pending",
  AUTHORIZED: "Authorized",
  PARTIALLY_PAID: "Partially paid",
  PARTIALLY_REFUNDED: "Partially refunded",
  REFUNDED: "Refunded",
  VOIDED: "Voided",
  EXPIRED: "Expired",
};

/** Email / payment lines under the addresses, when switched on. */
function contactHtml(order: PrintOrder, d: SlipDesign): string {
  const bits: string[] = [];
  if (d.showEmail && order.email) bits.push(`<span><strong>Email:</strong> ${escapeHtml(order.email)}</span>`);
  if (d.showPaymentStatus && order.displayFinancialStatus) {
    const p = PAYMENT_LABEL[order.displayFinancialStatus] ?? order.displayFinancialStatus;
    bits.push(`<span><strong>Payment:</strong> ${escapeHtml(p)}</span>`);
  }
  return bits.length ? `<div class="contact">${bits.join("")}</div>` : "";
}

function itemCount(order: PrintOrder): number {
  return itemsToShip(order).reduce((n, { qty }) => n + qty, 0);
}

const noteHtml = (order: PrintOrder, o: SlipOptions) =>
  o.showNote && order.note?.trim()
    ? `<div class="note"><h3>Order note</h3><p>${escapeHtml(order.note)}</p></div>`
    : "";

interface PageCtx {
  shop: PrintShop;
  weather: SlipWeather | undefined;
  unit: Unit;
  timeZone: string;
  o: SlipOptions;
}

/** Classic, Minimal and Detailed share one full-page layout. */
function fullPage(order: PrintOrder, c: PageCtx): string {
  const { o } = c;
  const d = o.design;
  const prices = o.template === "DETAILED";
  const weather =
    o.template === "MINIMAL"
      ? weatherTable(c.weather, c.unit, c.timeZone, false, d)
      : weatherCards(c.weather, c.unit, c.timeZone, d);
  const title = escapeHtml(d.title ?? (prices ? "Packing slip & receipt" : "Packing slip"));
  const logo = logoHtml(d);
  const meta = `
        <div class="meta">
          ${d.logoPosition === "right" ? logo : ""}
          <p><strong>Order ${escapeHtml(order.name)}</strong></p>
          ${d.showOrderDate ? `<p>${escapeHtml(longDate(order.createdAt, c.timeZone))}</p>` : ""}
          ${d.showShippingMethod && order.shippingLine ? `<p>${escapeHtml(order.shippingLine.title)}</p>` : ""}
        </div>`;
  const header =
    d.logoPosition === "center"
      ? `${logo ? `<div class="logo-center">${logo}</div>` : ""}<header><h1>${title}</h1>${meta}</header>`
      : d.logoPosition === "left"
        ? `<header><div class="brand">${logo}<h1>${title}</h1></div>${meta}</header>`
        : `<header><h1>${title}</h1>${meta}</header>`;
  return `
    <article class="page">
      ${header}
      ${headerNote(d)}
      <div class="addresses">
        <div><h3>Ship to</h3>${addressHtml(order.shippingAddress, order.phone, d.showPhone)}</div>
        ${o.showBilling ? `<div><h3>Bill to</h3>${addressHtml(order.billingAddress, null, d.showPhone)}</div>` : ""}
      </div>
      ${contactHtml(order, d)}
      ${weather ? `<hr>${weather}` : ""}
      <hr>
      <h3>Order details${d.showItemCount ? ` · ${itemCount(order)} ${itemCount(order) === 1 ? "item" : "items"}` : ""}</h3>
      ${itemsHtml(order, o, prices)}
      ${prices ? totalsHtml(order) : ""}
      ${noteHtml(order, o)}
      ${shopFooter(c.shop, o)}
    </article>`;
}

/** 4×6 in thermal label. */
function labelPage(order: PrintOrder, c: PageCtx): string {
  const items = itemsToShip(order)
    .map(
      ({ li, qty }) =>
        `<li><span>${escapeHtml(li.name)}${c.o.showSku && li.sku ? ` <span class="muted">(${escapeHtml(li.sku)})</span>` : ""}</span><strong>× ${qty}</strong></li>`,
    )
    .join("");
  const d = c.o.design;
  const logo = logoHtml(d, { S: 22, M: 30, L: 40 }[d.logoSize]);
  return `
    <article class="page">
      <header>
        <span class="brand">${logo}${d.showStoreName ? `<strong>${escapeHtml(c.shop.name)}</strong>` : ""}</span>
        <span><strong>${escapeHtml(order.name)}</strong>${d.showOrderDate ? ` · ${escapeHtml(longDate(order.createdAt, c.timeZone))}` : ""}</span>
      </header>
      ${headerNote(d)}
      <div class="shipto">
        <h3>Ship to</h3>
        ${addressHtml(order.shippingAddress, order.phone, d.showPhone)}
        ${d.showShippingMethod && order.shippingLine ? `<p class="muted">${escapeHtml(order.shippingLine.title)}</p>` : ""}
      </div>
      ${contactHtml(order, d)}
      ${weatherTable(c.weather, c.unit, c.timeZone, true, d)}
      <h3>Items${d.showItemCount ? ` (${itemCount(order)})` : ""}</h3>
      <ul class="lines">${items}</ul>
      ${noteHtml(order, c.o)}
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
  .page { background: #fff; width: 100%; max-width: 210mm; margin: 16px auto; padding: 14mm 12mm; }
  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
  header h1 { font-size: 1.85em; color: var(--accent, #111); }
  header .brand { display: flex; align-items: center; gap: 12px; }
  .logo { display: block; max-width: 220px; object-fit: contain; }
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
  .day .cond { color: #444; margin: 2px 0; }
  svg.wx { display: inline-block; vertical-align: middle; }
  .now svg.wx { margin: -3px 2px 0 0; }
  td.wxcell { white-space: nowrap; }
  td.wxcell svg.wx { margin: -2px 3px 0 0; }
  .day .lo, .day .rain { color: #555; font-size: 11px; }
  table.fc { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  table.fc th { text-align: left; font-size: 10px; border-bottom: 1px solid #111; padding: 2px 4px; }
  table.fc td { border-bottom: 1px solid #ddd; padding: 3px 4px; }
  table.fc tr.key td { font-weight: 700; border-bottom: 1px solid var(--accent, #111); }
  table.fc .num { text-align: right; }
  .asof { color: #888; font-size: 10px; }
  table.items { width: 100%; border-collapse: collapse; }
  table.items th { text-align: left; font-size: 11px; border-bottom: 1px solid #bbb; padding: 4px 6px; }
  table.items td { border-bottom: 1px solid #eee; padding: 6px; vertical-align: middle; }
  table.items .num { text-align: right; }
  td.img { width: 56px; }
  td.img img { width: 48px; height: 48px; object-fit: contain; display: block; }
  .noimg { display: inline-block; width: 48px; font-size: 9px; color: #999; text-align: center; }
  table.items .qty { text-align: right; white-space: nowrap; }
  table.totals { margin: 8px 0 0 auto; border-collapse: collapse; min-width: 220px; }
  table.totals td { padding: 3px 6px; }
  table.totals tr.grand td { font-weight: 700; border-top: 1px solid var(--accent, #111); }
  .note { margin-top: 12px; padding: 8px; border: 1px solid #ddd; background: #fafafa; }
  footer { margin-top: 24px; text-align: center; font-size: 11px; }
  .thanks { margin-bottom: 8px; }
  table.list { width: 100%; border-collapse: collapse; }
  table.list th, table.list td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  table.list th { background: #f3f3f3; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .page { margin: 0; padding: 0; max-width: none; break-after: page; }
    .page:last-child { break-after: auto; }
    .day, tr, li { break-inside: avoid; }
  }
`;

const MINIMAL_STYLES = `
  header h1 { font-size: 1.6em; }
  .note { background: none; border: 1px solid #111; }
  hr { margin: 8px 0; }
  table.items td { border-bottom: 1px solid #ccc; padding: 4px 6px; }
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
  ul.lines { list-style: none; }
  ul.lines li { display: flex; justify-content: space-between; gap: 8px; border-bottom: 1px dotted #999; padding: 2px 0; }
  .note { margin-top: 6px; padding: 4px; background: none; border: 1px solid #111; }
  .thanks { margin-top: 6px; text-align: center; font-size: 9px; }
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
  return `@page { size: ${p.css}; margin: ${p.id === "A5" ? "7mm" : "10mm"}; }
    .page { max-width: ${p.maxWidth}; }`;
}

/** The merchant's look, as CSS variables the base styles read. */
function designVars(d: SlipDesign, label: boolean): string {
  const base = FONT_SIZES.find((f) => f.id === d.fontSize)?.px ?? 12;
  const px = label ? base - 2 : base;
  return `:root { --accent: ${d.accent}; --font: ${FONTS[d.font].css}; --fs: ${px}px; }`;
}

function stylesFor(o: SlipOptions | null): string {
  if (!o) return BASE_STYLES + "@page { margin: 10mm; }";
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
}

function documentHtml(title: string, body: string, styles: string, d: DocOptions): string {
  const script = d.chrome
    ? `<script nonce="${d.nonce}">
  document.getElementById("print").addEventListener("click", function () { window.print(); });
  ${d.autoPrint ? `window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 300); });` : ""}
</script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style nonce="${d.nonce}">${styles}</style>
</head>
<body>
${d.chrome ? `<div class="bar"><span>${escapeHtml(title)}</span><button type="button" id="print">Print / Save as PDF</button></div>` : ""}
${body}
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
      const ctx: PageCtx = { shop, weather: weather.get(id), unit: opts.unit, timeZone: opts.timeZone, o };
      return o.template === "LABEL_4X6" ? labelPage(order, ctx) : fullPage(order, ctx);
    })
    .join("");
  const title = orders.length === 1 ? `Packing slip ${orders[0]!.name}` : `Packing slips (${orders.length})`;
  return documentHtml(title, pages, stylesFor(o), {
    nonce: opts.nonce,
    autoPrint: opts.autoPrint ?? true,
    chrome: opts.chrome ?? true,
  });
}

export function renderCustomerList(
  shop: PrintShop,
  orders: PrintOrder[],
  opts: Omit<SlipRenderOptions, "unit" | "slip">,
): string {
  const rows = orders
    .map((o, i) => {
      const a = o.shippingAddress;
      const customer = a?.name || o.billingAddress?.name || "";
      const dest = a ? [a.city, a.provinceCode, a.countryCodeV2].filter(Boolean).join(", ") : "";
      const items = o.lineItems.nodes.reduce((n, li) => n + li.unfulfilledQuantity, 0);
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
  return documentHtml(`Customer list (${orders.length})`, body, stylesFor(null), {
    nonce: opts.nonce,
    autoPrint: opts.autoPrint ?? true,
    chrome: opts.chrome ?? true,
  });
}
