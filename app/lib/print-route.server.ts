import { randomBytes } from "node:crypto";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { runInBackground } from "./background.server";
import { MAX_PRINT_ORDERS } from "./order-views";
import { ordersToPrint } from "./orders.server";
import { verifyPrintToken } from "./print-token.server";
import { notifyAdmin } from "./alerts.server";
import { drainQueue } from "./queue-runner.server";
import { brandLogoIfFresh } from "./brand-logo.server";
import { escapeHtml, isSlipTemplate, renderCustomerList, SLIP_TEMPLATES, renderPackingSlips, resolveLogo } from "./slip";
import { recordPrints, setChecklistStep, slipOptions } from "./shop.server";
import { weatherForSlips } from "./slip-weather.server";
import { distancesForSlips } from "./distance.server";
import { planAllowsOrder, PLANS, planSlipOptions, plansWith } from "./plans";

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

/** renderPrint, but a crash becomes an operator alert and a readable error page. */
async function safeRenderPrint(...args: Parameters<typeof renderPrint>): Promise<Response> {
  try {
    return await renderPrint(...args);
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n\n${err.stack ?? ""}` : String(err);
    await notifyAdmin(
      "print-failed",
      "Printing a packing slip failed",
      `Shop: ${args[0]}\nOrders: ${args[1].join(", ")}\nKind: ${args[2]}\n\n${msg.slice(0, 3000)}`,
    );
    return message(500, "Something went wrong while preparing this print. We've been notified — please try again in a minute.");
  }
}

/** The printable document for a shop's orders (shop already authorised). */
async function renderPrint(
  shopDomain: string,
  ids: string[],
  kind: PrintKind,
  tpl: string | null,
  opts: { autoPrint: boolean; chrome: boolean; frameAncestors?: string; fromShopify?: boolean },
): Promise<Response> {
  if (ids.length === 0) return message(400, "No orders selected.");

  const shop = await prisma.shop.findUnique({ where: { shop: shopDomain } });
  if (!shop || shop.uninstalledAt) return message(403, "Weather Slip isn't installed on this store.");

  // Plan gates (the UI hides these too; this is the enforcement).
  const plan = PLANS[shop.plan];
  if (opts.fromShopify && !plan.printFromShopify) {
    return message(
      403,
      `Printing from Shopify's Orders page is on the ${plansWith((p) => p.printFromShopify)} plans. Open Weather Slip → Orders to print, or upgrade in Weather Slip → Plans & pricing.`,
    );
  }
  if (kind === "customers" && !plan.customerList) {
    return message(
      403,
      `The customer list is on the ${plansWith((p) => p.customerList)} plans. Upgrade in Weather Slip → Plans & pricing.`,
    );
  }

  // A template picked for this print that the plan doesn't include is
  // refused, not quietly printed as Classic (the merchant would think they
  // got the layout they chose). Only the saved default is coerced.
  if (kind === "slips" && isSlipTemplate(tpl) && !plan.templates.includes(tpl)) {
    const name = SLIP_TEMPLATES.find((t) => t.id === tpl)?.name ?? tpl;
    return message(
      403,
      `The ${name} template is on the ${plansWith((p) => p.templates.includes(tpl))} plans — your ${plan.name} plan includes ${plan.templates.map((t) => SLIP_TEMPLATES.find((x) => x.id === t)?.name ?? t).join(" and ")}. Pick one of those, or upgrade in Weather Slip → Plans & pricing.`,
    );
  }

  const { admin } = await unauthenticated.admin(shopDomain);
  const { shop: shopInfo, orders: found } = await ordersToPrint(admin, ids);
  if (found.length === 0) return message(404, "Those orders weren't found.");

  // Free/Starter: unfulfilled orders only (reprints of earlier prints are fine).
  const printedBefore = new Set(
    (
      await prisma.printedOrder.findMany({
        where: { shop: shop.shop, orderId: { in: found.map((o) => o.id.slice(o.id.lastIndexOf("/") + 1)) } },
        select: { orderId: true },
      })
    ).map((p) => p.orderId),
  );
  const orders = found.filter((o) =>
    planAllowsOrder(shop.plan, o, printedBefore.has(o.id.slice(o.id.lastIndexOf("/") + 1))),
  );
  const skipped = found.filter((o) => !orders.includes(o)).map((o) => o.name);
  if (orders.length === 0) {
    return message(
      403,
      `Your ${plan.name} plan prints unfulfilled orders. ${skipped.join(", ")} ${skipped.length === 1 ? "is" : "are"} fulfilled, cancelled or archived — printing those is on the ${plansWith((p) => p.orderViews.length > 1)} plans. Upgrade in Weather Slip → Plans & pricing.`,
    );
  }
  const notice = skipped.length
    ? `Skipped ${skipped.join(", ")}: fulfilled, cancelled or archived orders are on the ${plansWith((p) => p.orderViews.length > 1)} plans.`
    : undefined;

  const timeZone = shopInfo.ianaTimezone || shop.timezone;
  const nonce = randomBytes(16).toString("base64");
  const doc = { timeZone, nonce, autoPrint: opts.autoPrint, chrome: opts.chrome };
  let html: string;
  if (kind === "customers") {
    html = renderCustomerList(shopInfo, orders, {
      ...doc,
      notice,
      mark: !plan.removeBranding || slipOptions(shop).design.showBranding,
    });
  } else {
    const weather = await weatherForSlips(shop, orders, admin);
    // Orders that had no snapshot yet were queued; get them saved now.
    runInBackground(drainQueue({ budgetMs: 20_000 }));
    // The shop's saved slip settings; a tpl picks another template for this
    // one print. planSlipOptions then drops whatever the plan doesn't
    // include (a locked template falls back to Classic).
    const saved = slipOptions(shop);
    if (isSlipTemplate(tpl)) saved.template = tpl;
    const slip = planSlipOptions(saved, shop.plan);
    const brandLogo = slip.design.logoSource === "store" ? await brandLogoIfFresh(admin, shop) : null;
    slip.design = resolveLogo(slip.design, brandLogo);
    const distance = slip.design.showDistance
      ? await distancesForSlips(shop, orders, admin, slip.design.distanceFrom)
      : undefined;
    html = renderPackingSlips(shopInfo, orders, weather, { ...doc, unit: shop.unit, slip, distance, notice });
    await recordPrints(shop.shop, orders.map((o) => o.id.slice(o.id.lastIndexOf("/") + 1)));
    if (opts.fromShopify) await setChecklistStep(shop.shop, "printFromShopify");
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
  return safeRenderPrint(shopDomain, parseOrderIds(url.searchParams.get("ids")), kind, url.searchParams.get("tpl"), {
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
  return safeRenderPrint(shopDomain, parseOrderIds(url.searchParams.get("ids")), kind, url.searchParams.get("tpl"), {
    autoPrint: false,
    chrome: false,
    frameAncestors: "https://admin.shopify.com https://*.myshopify.com",
    fromShopify: true,
  });
}
