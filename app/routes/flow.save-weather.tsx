import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { runInBackground } from "../lib/background.server";
import { flowFailure, flowOrderId } from "../lib/flow-action";
import { ordersToPrint } from "../lib/orders.server";
import { PLANS, plansWith } from "../lib/plans";
import { drainQueue } from "../lib/queue-runner.server";
import { weatherForSlips } from "../lib/slip-weather.server";

// Shopify Flow action "Save weather on order" (extensions/weather-slip-flow-save).
// Same path as a first print: the order is counted once, its slip forecast is
// saved on the order, and a CREATE job writes the summary metafield for
// Shopify's own packing slip. Repeats (Flow retries, paid then fulfilled)
// reuse the saved forecast and never count again.
//
// Flow waits 10 s for a status: 200 = done, 4xx = failed with our message
// shown in the run log (no retry), 5xx = retried for up to 36 h.
const BUDGET_MS = 7_000;

export const action = async ({ request }: ActionFunctionArgs) => {
  // Verifies the HMAC; throws a 401 response for anything not from Flow.
  const { session, admin, payload } = await authenticate.flow(request);

  const shop = await prisma.shop.findUnique({ where: { shop: session.shop } });
  if (!shop || shop.uninstalledAt) return flowFailure(404, "Weather Slip isn't installed on this store.");
  if (!PLANS[shop.plan].flowAutomation) {
    return flowFailure(
      402,
      `Saving weather from Shopify Flow is on the ${plansWith((p) => p.flowAutomation)} plans. Upgrade in Weather Slip → Plans & pricing.`,
    );
  }
  const orderId = flowOrderId(payload);
  if (!orderId) return flowFailure(400, "No order in this workflow step.");

  const work = (async () => {
    const { orders } = await ordersToPrint(admin, [orderId]);
    if (!orders.length) return "missing" as const;
    const weather = await weatherForSlips(shop, orders, admin);
    runInBackground(drainQueue({ budgetMs: 20_000 }));
    return weather.get(orderId)?.status ?? "error";
  })();

  // Finish in the background if the lookup runs long; Flow just needs a status.
  const status = await Promise.race([
    work,
    new Promise<"slow">((resolve) => setTimeout(() => resolve("slow"), BUDGET_MS)),
  ]);
  if (status === "slow") {
    runInBackground(work.then(() => undefined));
    return new Response(null, { status: 200 });
  }
  if (status === "missing") return flowFailure(404, `Order ${orderId} wasn't found.`);
  if (status === "limit_reached") {
    // 422, not 429: a 429 makes Flow retry for 36 h against a monthly limit.
    return flowFailure(422, "This month's order limit is reached, so weather wasn't saved. Upgrade in Weather Slip → Plans & pricing.");
  }
  // "no_location" (pickup, POS, no address) has nothing to forecast — not a failure.
  if (status === "error") throw new Response("Weather lookup failed", { status: 503 });
  return new Response(null, { status: 200 });
};
