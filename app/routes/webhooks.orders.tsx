import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { runInBackground } from "../lib/background.server";
import { enqueue } from "../lib/jobs.server";
import { locationKey } from "../lib/location";
import { freezeSnapshot } from "../lib/order-weather.server";
import { drainQueue } from "../lib/queue-runner.server";
import { ensureShop } from "../lib/shop.server";

interface OrderWebhook {
  id: number;
  fulfillment_status: string | null;
  shipping_address?: {
    latitude?: number | null;
    longitude?: number | null;
    city?: string | null;
    zip?: string | null;
    country_code?: string | null;
  } | null;
}

// orders/updated (and stray orders/create). Respond fast (Shopify retries after 5s);
// the actual weather work runs after the response via runInBackground, with
// the cron drain as the safety net. The payload's address is only used to
// compute a fingerprint here — it's never stored or queued.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const order = payload as OrderWebhook;
  const orderId = String(order.id);

  // Weather is fetched (and the order counted) only when the merchant
  // prints its slip, so a new order needs nothing. orders/create is no
  // longer subscribed; this stays for deliveries already in flight.
  if (topic === "ORDERS_CREATE") {
    await ensureShop(shop);
    return new Response();
  }

  if (topic === "ORDERS_UPDATED") {
    const latest = await prisma.orderWeatherSnapshot.findFirst({
      where: { shop, orderId },
      orderBy: { version: "desc" },
      select: { locationKey: true, frozenAt: true },
    });
    // No snapshot yet: the CREATE job will read the current address anyway.
    if (!latest) return new Response();

    if (order.fulfillment_status === "fulfilled" || order.fulfillment_status === "partial") {
      await freezeSnapshot(shop, orderId);
      return new Response();
    }

    // Our own metafieldsSet also fires orders/updated; an unchanged
    // destination makes that a no-op instead of a loop.
    const a = order.shipping_address;
    const key = a
      ? locationKey({
          latitude: a.latitude,
          longitude: a.longitude,
          city: a.city,
          zip: a.zip,
          countryCode: a.country_code,
        })
      : null;
    if (!latest.frozenAt && key !== latest.locationKey) {
      await enqueue(shop, orderId, "ADDRESS_CHANGE");
      runInBackground(drainQueue({ budgetMs: 20_000 }));
    }
  }

  return new Response();
};
