import { randomBytes } from "node:crypto";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { runInBackground } from "./background.server";
import { MAX_PRINT_ORDERS } from "./order-views";
import { ordersToPrint } from "./orders.server";
import { verifyPrintToken } from "./print-token.server";
import { drainQueue } from "./queue-runner.server";
import { escapeHtml, isSlipTemplate, renderCustomerList, renderPackingSlips } from "./slip";
import { slipOptions } from "./shop.server";
import { weatherForSlips } from "./slip-weather.server";

// These pages carry customer names and addresses: never cache them, never
// leak the URL (it holds the print token) in a Referer, never let them be
// framed or indexed. Only Shopify's CDN may supply images.
// `frameAncestors`: the Shopify admin shows a print action's document in
// its own preview frame, so that route allows the admin to frame it.
function securityHeaders(nonce: string, frameAncestors = "'none'"): HeadersInit {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": [
      "default-src 'none'",
      "img-src https://cdn.shopify.com data:",
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
      "base-uri 'none'",
      "form-action 'none'",
      `frame-ancestors ${frameAncestors}`,
    ].join("; "),
  };
}

function message(status: number, text: string): Response {
  const nonce = randomBytes(16).toString("base64");
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Weather Slip</title>
     <p style="font:15px sans-serif;margin:40px">${escapeHtml(text)}</p>`,
    { status, headers: securityHeaders(nonce) },
  );
}

export type PrintKind = "slips" | "customers";

export function parseOrderIds(raw: string | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.slice(id.lastIndexOf("/") + 1)) // accepts numeric ids or gids
    .filter((id) => /^\d{1,20}$/.test(id))
    .slice(0, MAX_PRINT_ORDERS);
}

/** The printable document for a shop's orders (shop already authorised). */
async function renderPrint(
  shopDomain: string,
  ids: string[],
  kind: PrintKind,
  tpl: string | null,
  opts: { autoPrint: boolean; chrome: boolean; frameAncestors?: string },
): Promise<Response> {
  if (ids.length === 0) return message(400, "No orders selected.");

  const shop = await prisma.shop.findUnique({ where: { shop: shopDomain } });
  if (!shop || shop.uninstalledAt) return message(403, "Weather Slip isn't installed on this store.");

  const { admin } = await unauthenticated.admin(shopDomain);
  const { shop: shopInfo, orders } = await ordersToPrint(admin, ids);
  if (orders.length === 0) return message(404, "Those orders weren't found.");

  const timeZone = shopInfo.ianaTimezone || shop.timezone;
  const nonce = randomBytes(16).toString("base64");
  const doc = { timeZone, nonce, autoPrint: opts.autoPrint, chrome: opts.chrome };
  let html: string;
  if (kind === "customers") {
    html = renderCustomerList(shopInfo, orders, doc);
  } else {
    const weather = await weatherForSlips(shop, orders);
    // Orders that had no snapshot yet were queued; get them saved now.
    runInBackground(drainQueue({ budgetMs: 20_000 }));
    // The shop's saved slip settings; a tpl picks another template for this
    // one print.
    const slip = slipOptions(shop);
    if (isSlipTemplate(tpl)) slip.template = tpl;
    html = renderPackingSlips(shopInfo, orders, weather, { ...doc, unit: shop.unit, slip });
  }
  return new Response(html, { headers: securityHeaders(nonce, opts.frameAncestors) });
}

/** /print/slips and /print/customers: a new browser tab, authorised by a print token. */
export async function printResponse(request: Request, kind: PrintKind) {
  const url = new URL(request.url);
  const shopDomain = verifyPrintToken(url.searchParams.get("t"));
  if (!shopDomain) {
    return message(401, "This print link has expired. Go back to Weather Slip in your Shopify admin and print again.");
  }
  return renderPrint(shopDomain, parseOrderIds(url.searchParams.get("ids")), kind, url.searchParams.get("tpl"), {
    autoPrint: true,
    chrome: true,
  });
}

/**
 * /print/admin: the document behind the "Weather slip" print action in
 * Shopify's own Orders section. The admin itself previews and prints it,
 * so no toolbar or auto-print, and the admin may frame it. Authorised by
 * the caller (authenticate.admin) — the shop comes from its session.
 */
export function adminPrintResponse(shopDomain: string, url: URL): Promise<Response> {
  const kind: PrintKind = url.searchParams.get("kind") === "customers" ? "customers" : "slips";
  return renderPrint(shopDomain, parseOrderIds(url.searchParams.get("ids")), kind, url.searchParams.get("tpl"), {
    autoPrint: false,
    chrome: false,
    frameAncestors: "https://admin.shopify.com https://*.myshopify.com",
  });
}
