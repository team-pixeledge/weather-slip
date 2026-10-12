// Printable packing slips and the customer list, rendered as one plain HTML
// document per print run. The browser prints it (or saves it as PDF), so
// there's no headless Chrome to run on Vercel. Pure: no server imports, so
// it's unit-tested directly.
import { addDays, shortDay, type IsoDate } from "./dates";
import { cToF, type Unit } from "./format";
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

function weatherHtml(w: SlipWeather | undefined, unit: Unit, timeZone: string): string {
  if (!w) return "";
  const dates = `
    <div class="dates">
      <p><strong>Dispatch:</strong> ${escapeHtml(longDay(w.dispatch))}</p>
      <p><strong>Estimated delivery:</strong> ${escapeHtml(longDay(w.delivery))}</p>
    </div>`;
  if (w.status !== "ok") {
    const why =
      w.status === "limit_reached"
        ? "Weather not included: this month's plan limit is reached."
        : w.status === "no_location"
          ? "Weather not available: no shipping destination."
          : "Weather temporarily unavailable.";
    return `<section class="weather">${dates}<p class="muted">${escapeHtml(why)}</p></section>`;
  }

  const boxes = w.days
    .map((d) => {
      const tags = [
        d.date === w.dispatch ? "Dispatch" : null,
        d.date === w.delivery ? "Delivery" : null,
      ].filter(Boolean);
      const rain =
        d.precipProb != null && d.precipProb >= 20 ? `<div class="rain">${d.precipProb}% rain</div>` : "";
      return `
        <div class="day${tags.length ? " key" : ""}">
          <div class="d">${escapeHtml(shortDay(d.date))}</div>
          ${tags.length ? `<div class="tag">${escapeHtml(tags.join(" · "))}</div>` : ""}
          <div class="cond">${escapeHtml(d.label)}</div>
          <div class="t">${escapeHtml(temp(d.maxC, unit))}</div>
          <div class="t lo">${escapeHtml(temp(d.minC, unit))}</div>
          ${rain}
        </div>`;
    })
    .join("");

  const notes: string[] = [];
  if (w.delivery > w.horizonEnd) {
    notes.push(
      `Delivery day (${shortDay(w.delivery)}) is beyond the forecast range (to ${shortDay(w.horizonEnd)}).`,
    );
  } else if (w.delivery < (w.days[0]?.date ?? w.delivery)) {
    notes.push(`Estimated delivery date has passed.`);
  }
  const asOf = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(w.asOf));

  return `
    <section class="weather">
      ${dates}
      <h3>Weather forecast — ${escapeHtml(placeText(w) || "destination")}</h3>
      ${w.current ? `<p class="now">Now: ${escapeHtml(temp(w.current.tempC, unit))}, ${escapeHtml(w.current.label)}</p>` : ""}
      <div class="days">${boxes || `<p class="muted">No forecast days available.</p>`}</div>
      ${notes.map((n) => `<p class="muted">${escapeHtml(n)}</p>`).join("")}
      <p class="asof">Forecast as of ${escapeHtml(asOf)}</p>
    </section>`;
}

function itemsHtml(order: PrintOrder): string {
  const all = order.lineItems.nodes;
  const open = all.filter((li) => li.unfulfilledQuantity > 0);
  const items = open.length ? open : all;
  const rows = items
    .map((li) => {
      const qty = open.length ? li.unfulfilledQuantity : li.quantity;
      const img = li.image
        ? `<img src="${escapeHtml(li.image.url)}" alt="${escapeHtml(li.image.altText ?? "")}">`
        : `<span class="noimg">No image</span>`;
      return `
        <tr>
          <td class="img">${img}</td>
          <td>
            <div>${escapeHtml(li.name)}</div>
            ${li.sku ? `<div class="muted">SKU: ${escapeHtml(li.sku)}</div>` : ""}
          </td>
          <td class="qty">${qty} of ${li.quantity}</td>
        </tr>`;
    })
    .join("");
  return `
    <table class="items">
      <thead><tr><th></th><th>Item</th><th class="qty">Quantity</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function shopFooter(shop: PrintShop): string {
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
      <p class="thanks">Thank you for shopping with us!</p>
      <p><strong>${escapeHtml(shop.name)}</strong></p>
      ${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}
    </footer>`;
}

const STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font: 12px/1.45 -apple-system, "Segoe UI", Arial, sans-serif; color: #111; background: #f3f3f3; }
  .bar { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; justify-content: space-between;
         padding: 10px 16px; background: #1a1a1a; color: #fff; font-size: 13px; }
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
  .weather .dates { display: flex; gap: 24px; margin-bottom: 10px; }
  .weather .now { margin-bottom: 6px; }
  .days { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
  .day { border: 1px solid #bbb; border-radius: 4px; padding: 6px 8px; min-width: 92px; flex: 1 1 92px; }
  .day.key { border: 2px solid #111; }
  .day .d { font-weight: 600; }
  .day .tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
  .day .cond { color: #444; margin: 2px 0; }
  .day .lo, .day .rain { color: #555; font-size: 11px; }
  .asof { color: #888; font-size: 10px; }
  table.items { width: 100%; border-collapse: collapse; }
  table.items th { text-align: left; font-size: 11px; border-bottom: 1px solid #bbb; padding: 4px 6px; }
  table.items td { border-bottom: 1px solid #eee; padding: 6px; vertical-align: middle; }
  td.img { width: 56px; }
  td.img img { width: 48px; height: 48px; object-fit: contain; display: block; }
  .noimg { display: inline-block; width: 48px; font-size: 9px; color: #999; text-align: center; }
  table.items .qty { text-align: right; white-space: nowrap; }
  .note { margin-top: 12px; padding: 8px; border: 1px solid #ddd; background: #fafafa; }
  footer { margin-top: 24px; text-align: center; font-size: 11px; }
  footer .thanks { margin-bottom: 8px; }
  table.list { width: 100%; border-collapse: collapse; }
  table.list th, table.list td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  table.list th { background: #f3f3f3; }
  @page { margin: 10mm; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .page { margin: 0; padding: 0; max-width: none; break-after: page; }
    .page:last-child { break-after: auto; }
    .day, tr { break-inside: avoid; }
  }
`;

function documentHtml(title: string, body: string, nonce: string, autoPrint: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style nonce="${nonce}">${STYLES}</style>
</head>
<body>
<div class="bar"><span>${escapeHtml(title)}</span><button type="button" id="print">Print / Save as PDF</button></div>
${body}
<script nonce="${nonce}">
  document.getElementById("print").addEventListener("click", function () { window.print(); });
  ${autoPrint ? `window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 300); });` : ""}
</script>
</body>
</html>`;
}

export interface SlipRenderOptions {
  unit: Unit;
  timeZone: string;
  nonce: string;
  autoPrint?: boolean;
}

export function renderPackingSlips(
  shop: PrintShop,
  orders: PrintOrder[],
  weather: Map<string, SlipWeather>,
  opts: SlipRenderOptions,
): string {
  const pages = orders
    .map((o) => {
      const id = o.id.slice(o.id.lastIndexOf("/") + 1);
      return `
      <article class="page">
        <header>
          <h1>Packing slip</h1>
          <div class="meta">
            <p><strong>Order ${escapeHtml(o.name)}</strong></p>
            <p>${escapeHtml(longDate(o.createdAt, opts.timeZone))}</p>
            ${o.shippingLine ? `<p>${escapeHtml(o.shippingLine.title)}</p>` : ""}
          </div>
        </header>
        <div class="addresses">
          <div><h3>Ship to</h3>${addressHtml(o.shippingAddress, o.phone)}</div>
          <div><h3>Bill to</h3>${addressHtml(o.billingAddress)}</div>
        </div>
        <hr>
        ${weatherHtml(weather.get(id), opts.unit, opts.timeZone)}
        <hr>
        <h3>Order details</h3>
        ${itemsHtml(o)}
        ${o.note?.trim() ? `<div class="note"><h3>Order note</h3><p>${escapeHtml(o.note)}</p></div>` : ""}
        ${shopFooter(shop)}
      </article>`;
    })
    .join("");
  const title = orders.length === 1 ? `Packing slip ${orders[0]!.name}` : `Packing slips (${orders.length})`;
  return documentHtml(title, pages, opts.nonce, opts.autoPrint ?? true);
}

export function renderCustomerList(
  shop: PrintShop,
  orders: PrintOrder[],
  opts: Omit<SlipRenderOptions, "unit">,
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
  return documentHtml(`Customer list (${orders.length})`, body, opts.nonce, opts.autoPrint ?? true);
}
