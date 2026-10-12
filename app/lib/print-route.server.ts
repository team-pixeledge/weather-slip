import { randomBytes } from "node:crypto";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { runInBackground } from "./background.server";
import { MAX_PRINT_ORDERS } from "./order-views";
import { ordersToPrint } from "./orders.server";
import { verifyPrintToken } from "./print-token.server";
import { drainQueue } from "./queue-runner.server";
import { escapeHtml, renderCustomerList, renderPackingSlips } from "./slip";
import { weatherForSlips } from "./slip-weather.server";

// These pages carry customer names and addresses: never cache them, never
// leak the URL (it holds the print token) in a Referer, never let them be
// framed or indexed. Only Shopify's CDN may supply images.
function securityHeaders(nonce: string): HeadersInit {
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
      "frame-ancestors 'none'",
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

export async function printResponse(request: Request, kind: "slips" | "customers") {
  const url = new URL(request.url);
  const shopDomain = verifyPrintToken(url.searchParams.get("t"));
  if (!shopDomain) {
    return message(401, "This print link has expired. Go back to Weather Slip in your Shopify admin and print again.");
  }
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .filter((id) => /^\d{1,20}$/.test(id))
    .slice(0, MAX_PRINT_ORDERS);
  if (ids.length === 0) return message(400, "No orders selected.");

  const shop = await prisma.shop.findUnique({ where: { shop: shopDomain } });
  if (!shop || shop.uninstalledAt) return message(403, "Weather Slip isn't installed on this store.");

  const { admin } = await unauthenticated.admin(shopDomain);
  const { shop: shopInfo, orders } = await ordersToPrint(admin, ids);
  if (orders.length === 0) return message(404, "Those orders weren't found.");

  const timeZone = shopInfo.ianaTimezone || shop.timezone;
  const nonce = randomBytes(16).toString("base64");
  let html: string;
  if (kind === "customers") {
    html = renderCustomerList(shopInfo, orders, { timeZone, nonce });
  } else {
    const weather = await weatherForSlips(shop, orders);
    // Orders that had no snapshot yet were queued; get them saved now.
    runInBackground(drainQueue({ budgetMs: 20_000 }));
    html = renderPackingSlips(shopInfo, orders, weather, { unit: shop.unit, timeZone, nonce });
  }
  return new Response(html, { headers: securityHeaders(nonce) });
}
