import type { Shop } from "@prisma/client";
import prisma from "../db.server";
import { enqueue } from "./jobs.server";
import { cacheKey } from "./location";
import { orderShippingDates } from "./order-weather.server";
import type { PrintOrder } from "./orders.server";
import { countOrder, providerFor } from "./shop.server";
import { slipForecast, type SlipWeather } from "./slip";
import { destinationToday } from "./snapshot";
import { cachedForecast, cachedGeocode } from "./weather/cache.server";
import type { ForecastPayload, GeoPoint } from "./weather/types";

/**
 * Destination forecast for each order being printed, keyed by numeric
 * order ID. This is the live forecast at print time (the 3h shared cache),
 * from today at the destination through the provider's horizon — the
 * packing slip is printed when the parcel is packed, so that's the window
 * that matters. The order's saved metafield snapshot is untouched.
 *
 * This is where orders get counted: plans count orders whose slip is
 * printed with weather, not API calls. The first print of an order with a
 * usable destination counts it (once — reprints are free); at the limit it
 * prints without weather. An order without saved weather also gets a job
 * that writes its metafield, so Shopify's own slip/invoice shows it after.
 */
export async function weatherForSlips(
  shop: Shop,
  orders: PrintOrder[],
  now = new Date(),
): Promise<Map<string, SlipWeather>> {
  const provider = providerFor(shop);
  const ids = orders.map((o) => o.id.slice(o.id.lastIndexOf("/") + 1));
  const snaps = await prisma.$queryRaw<
    { orderId: string; status: string; dispatchDate: string | null; deliveryDate: string | null }[]
  >`
    SELECT DISTINCT ON ("orderId") "orderId", status, "dispatchDate", "deliveryDate"
      FROM "OrderWeatherSnapshot"
     WHERE shop = ${shop.shop} AND "orderId" = ANY(${ids})
     ORDER BY "orderId", version DESC`;
  const snapBy = new Map(snaps.map((s) => [s.orderId, s]));

  // One provider call per grid cell for the whole print run.
  const forecasts = new Map<string, Promise<ForecastPayload>>();
  const forecastFor = (p: GeoPoint) => {
    const key = cacheKey(provider.id, p);
    let f = forecasts.get(key);
    if (!f) {
      f = cachedForecast(provider, p, now);
      forecasts.set(key, f);
    }
    return f;
  };

  const out = new Map<string, SlipWeather>();

  await Promise.all(
    orders.map(async (order, i) => {
      const id = ids[i]!;
      const snap = snapBy.get(id);
      const computed = orderShippingDates(order, shop);
      // Keep the dates the saved snapshot used, so slip and metafield agree.
      const dispatch = snap?.dispatchDate ?? computed.dispatch;
      const delivery = snap?.deliveryDate ?? computed.delivery;
      const a = order.shippingAddress;
      const place = { city: a?.city ?? null, countryCode: a?.countryCodeV2 ?? null };

      try {
        let point: GeoPoint | null =
          a?.latitude != null && a?.longitude != null ? { lat: a.latitude, lon: a.longitude } : null;
        if (!point && a && (a.city || a.zip)) {
          point = await cachedGeocode(
            provider,
            { city: a.city ?? "", zip: a.zip, countryCode: a.countryCodeV2 },
            now,
          );
        }
        if (!point) {
          out.set(id, { status: "no_location", ...place, dispatch, delivery });
          return;
        }
        if (!(await countOrder(shop, id, now))) {
          out.set(id, { status: "limit_reached", ...place, dispatch, delivery });
          return;
        }
        if (snap?.status !== "OK" && snap?.status !== "PENDING_DATES") {
          // Already counted above, so the job won't count it again.
          await enqueue(shop.shop, id, snap ? "REFRESH" : "CREATE");
        }
        const forecast = await forecastFor(point);
        out.set(id, {
          status: "ok",
          ...place,
          dispatch,
          delivery,
          ...slipForecast(forecast, destinationToday(forecast, now), provider.horizonDays),
          asOf: now.toISOString(),
        });
      } catch (err) {
        console.error("[slip-weather]", id, err instanceof Error ? err.message : err);
        out.set(id, { status: "error", ...place, dispatch, delivery });
      }
    }),
  );
  return out;
}
