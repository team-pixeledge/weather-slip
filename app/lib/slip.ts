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
export type PaperSize = "A4" | "LETTER";

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
    name: "4×6 label",
    description: "For thermal label printers: big ship-to address, forecast and items on a 4×6 in label.",
  },
];

/** Merchant's slip settings (Shop row); also overridable per print. */
export interface SlipOptions {
  template: SlipTemplate;
  paper: PaperSize;
  showImages: boolean;
  showSku: boolean;
  showBilling: boolean;
  showNote: boolean;
  /** Replaces "Thank you for shopping with us!"; empty hides it. */
  footer: string | null;
}

export const DEFAULT_SLIP_OPTIONS: SlipOptions = {
  template: "CLASSIC",
  paper: "A4",
  showImages: true,
  showSku: true,
  showBilling: true,
  showNote: true,
  footer: null,
};

export const isSlipTemplate = (v: unknown): v is SlipTemplate =>
  SLIP_TEMPLATES.some((t) => t.id === v);

export const FOOTER_MAX = 300;

function addressHtml(a: PrintAddress | null, phoneFallback?: string | null): string {
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
  if (phone) lines.push(`Phone: ${phone}`);
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
function weatherCards(w: SlipWeather | undefined, unit: Unit, timeZone: string): string {
  if (!w) return "";
  const dates = `
    <div class="dates">
      <p><strong>Dispatch:</strong> ${escapeHtml(longDay(w.dispatch))}</p>
      <p><strong>Estimated delivery:</strong> ${escapeHtml(longDay(w.delivery))}</p>
    </div>`;
  if (w.status !== "ok") {
    return `<section class="weather">${dates}<p class="muted">${escapeHtml(unavailableText(w.status))}</p></section>`;
  }
  const boxes = w.days
    .map((d) => {
      const tags = dayTags(w, d.date);
      const rain =
        d.precipProb != null && d.precipProb >= 20 ? `<div class="rain">${d.precipProb}% rain</div>` : "";
      return `
        <div class="day${tags.length ? " key" : ""}">
          <div class="d">${escapeHtml(shortDay(d.date))}</div>
          ${tags.length ? `<div class="tag">${escapeHtml(tags.join(" · "))}</div>` : ""}
          <div class="icon">${weatherIcon(d.label, 34)}</div>
          <div class="cond">${escapeHtml(d.label)}</div>
          <div class="t">${escapeHtml(temp(d.maxC, unit))}</div>
          <div class="t lo">${escapeHtml(temp(d.minC, unit))}</div>
          ${rain}
        </div>`;
    })
    .join("");
  return `
    <section class="weather">
      ${dates}
      <h3>Weather forecast — ${escapeHtml(placeText(w) || "destination")}</h3>
      ${w.current ? `<p class="now">${weatherIcon(w.current.label, 18)} Now: ${escapeHtml(temp(w.current.tempC, unit))}, ${escapeHtml(w.current.label)}</p>` : ""}
      <div class="days">${boxes || `<p class="muted">No forecast days available.</p>`}</div>
      ${forecastNotes(w).map((n) => `<p class="muted">${escapeHtml(n)}</p>`).join("")}
      <p class="asof">Forecast as of ${escapeHtml(asOfText(w.asOf, timeZone))}</p>
    </section>`;
}

/** Forecast as a compact table (Minimal, 4×6 label). */
function weatherTable(w: SlipWeather | undefined, unit: Unit, timeZone: string, compact: boolean): string {
  if (!w) return "";
  const dates = compact
    ? `<p class="dates"><strong>Dispatch</strong> ${escapeHtml(shortDay(w.dispatch))} · <strong>Delivery</strong> ${escapeHtml(shortDay(w.delivery))}</p>`
    : `<p class="dates"><strong>Dispatch:</strong> ${escapeHtml(longDay(w.dispatch))} &nbsp; <strong>Estimated delivery:</strong> ${escapeHtml(longDay(w.delivery))}</p>`;
  if (w.status !== "ok") {
    return `<section class="weather">${dates}<p class="muted">${escapeHtml(unavailableText(w.status))}</p></section>`;
  }
  const rows = w.days
    .map((d) => {
      const tags = dayTags(w, d.date);
      const rain = d.precipProb != null && d.precipProb >= 20 ? `${d.precipProb}%` : "";
      return `<tr${tags.length ? ' class="key"' : ""}>
        <td>${escapeHtml(shortDay(d.date))}${tags.length ? ` <span class="tag">${escapeHtml(tags.join("/"))}</span>` : ""}</td>
        <td class="wxcell">${weatherIcon(d.label, compact ? 14 : 16)} ${escapeHtml(d.label)}</td>
        <td class="num">${escapeHtml(temp(d.maxC, unit))}</td>
        <td class="num">${escapeHtml(temp(d.minC, unit))}</td>
        <td class="num">${rain}</td>
      </tr>`;
    })
    .join("");
  return `
    <section class="weather">
      ${dates}
      <h3>Forecast — ${escapeHtml(placeText(w) || "destination")}${w.current ? ` <span class="muted">(now ${escapeHtml(temp(w.current.tempC, unit))}, ${escapeHtml(w.current.label)})</span>` : ""}</h3>
      <table class="fc">
        <thead><tr><th>Day</th><th>Weather</th><th class="num">High</th><th class="num">Low</th><th class="num">Rain</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${forecastNotes(w).map((n) => `<p class="muted">${escapeHtml(n)}</p>`).join("")}
      <p class="asof">Forecast as of ${escapeHtml(asOfText(w.asOf, timeZone))}</p>
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

function shopFooter(shop: PrintShop, o: SlipOptions): string {
  const a = shop.shopAddress;
  const lines = [
    a?.address1,
    a?.address2,
    [a?.city, a?.province, a?.zip].filter(Boolean).join(" "),
    a?.country,
    shop.contactEmail,
    shop.primaryDomain?.host,
  ].filter((l): l is string => Boolean(l && l.trim()));
  return `
    <footer>
      ${thanks(o)}
      <p><strong>${escapeHtml(shop.name)}</strong></p>
      ${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}
    </footer>`;
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
  const prices = o.template === "DETAILED";
  const weather =
    o.template === "MINIMAL"
      ? weatherTable(c.weather, c.unit, c.timeZone, false)
      : weatherCards(c.weather, c.unit, c.timeZone);
  return `
    <article class="page">
      <header>
        <h1>${prices ? "Packing slip &amp; receipt" : "Packing slip"}</h1>
        <div class="meta">
          <p><strong>Order ${escapeHtml(order.name)}</strong></p>
          <p>${escapeHtml(longDate(order.createdAt, c.timeZone))}</p>
          ${order.shippingLine ? `<p>${escapeHtml(order.shippingLine.title)}</p>` : ""}
        </div>
      </header>
      <div class="addresses">
        <div><h3>Ship to</h3>${addressHtml(order.shippingAddress, order.phone)}</div>
        ${o.showBilling ? `<div><h3>Bill to</h3>${addressHtml(order.billingAddress)}</div>` : ""}
      </div>
      <hr>
      ${weather}
      <hr>
      <h3>Order details</h3>
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
  return `
    <article class="page">
      <header>
        <strong>${escapeHtml(c.shop.name)}</strong>
        <span><strong>${escapeHtml(order.name)}</strong> · ${escapeHtml(longDate(order.createdAt, c.timeZone))}</span>
      </header>
      <div class="shipto">
        <h3>Ship to</h3>
        ${addressHtml(order.shippingAddress, order.phone)}
        ${order.shippingLine ? `<p class="muted">${escapeHtml(order.shippingLine.title)}</p>` : ""}
      </div>
      ${weatherTable(c.weather, c.unit, c.timeZone, true)}
      <h3>Items</h3>
      <ul class="lines">${items}</ul>
      ${noteHtml(order, c.o)}
      ${thanks(c.o)}
    </article>`;
}

const BASE_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font: 12px/1.45 -apple-system, "Segoe UI", Arial, sans-serif; color: #111; background: #f3f3f3; }
  .bar { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; justify-content: space-between;
         padding: 10px 16px; background: #1a1a1a; color: #fff; font-size: 13px; z-index: 1; }
  .bar button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 0; background: #fff; color: #111; cursor: pointer; }
  .page { background: #fff; width: 100%; max-width: 210mm; margin: 16px auto; padding: 14mm 12mm; }
  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
  header h1 { font-size: 22px; }
  header .meta { text-align: right; }
  .addresses { display: flex; gap: 32px; margin-bottom: 12px; }
  .addresses > div { flex: 1; }
  h3 { font-size: 12px; margin-bottom: 6px; }
  hr { border: 0; border-top: 1px solid #111; margin: 12px 0; }
  .muted { color: #666; }
  .num { text-align: right; white-space: nowrap; }
  .weather .dates { display: flex; gap: 24px; margin-bottom: 10px; }
  .weather .now { margin-bottom: 6px; }
  .days { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
  .day { border: 1px solid #bbb; border-radius: 4px; padding: 6px 8px; min-width: 92px; flex: 1 1 92px; }
  .day.key { border: 2px solid #111; }
  .day .d { font-weight: 600; }
  .day .tag, .fc .tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
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
  table.fc tr.key td { font-weight: 700; border-bottom: 1px solid #111; }
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
  table.totals tr.grand td { font-weight: 700; border-top: 1px solid #111; }
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
  body { font-size: 11px; }
  header h1 { font-size: 18px; }
  .note { background: none; border: 1px solid #111; }
  hr { margin: 8px 0; }
  table.items td { border-bottom: 1px solid #ccc; padding: 4px 6px; }
`;

const LABEL_STYLES = `
  body { font-size: 10px; line-height: 1.3; }
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
  if (o.template === "LABEL_4X6") return "";
  return `@page { size: ${o.paper === "LETTER" ? "letter" : "A4"}; margin: 10mm; }
    .page { max-width: ${o.paper === "LETTER" ? "8.5in" : "210mm"}; }`;
}

function stylesFor(o: SlipOptions | null): string {
  if (!o) return BASE_STYLES + "@page { margin: 10mm; }";
  return (
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
