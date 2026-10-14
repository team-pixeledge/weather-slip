import type { Shop } from "@prisma/client";
import prisma from "../db.server";
import { METAFIELD_FORECAST_KEY, METAFIELD_NAMESPACE } from "./constants";
import { enqueue } from "./jobs.server";
import { cacheKey } from "./location";
import { notifyAdminLater } from "./alerts.server";
import { orderShippingDates } from "./order-weather.server";
import { query, type GraphqlClient, type PrintOrder } from "./orders.server";
import { countOrder, providerFor } from "./shop.server";
import { parseSavedSlipWeather, slipForecast, type SlipWeather } from "./slip";
import { destinationToday } from "./snapshot";
import { cachedForecast, cachedGeocode } from "./weather/cache.server";
import type { ForecastPayload, GeoPoint } from "./weather/types";

const SAVE_FORECASTS = `#graphql
  mutation WeatherSlipSaveForecast($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { userErrors { field message } }
  }`;

/**
 * Save each freshly fetched slip forecast on its order
 * (weather_slip.forecast), so reprints read it back instead of calling the
 * weather API. metafieldsSet takes at most 25 per call. Never throws: a
 * failed save only means the next print fetches again.
 */
async function saveForecasts(admin: GraphqlClient, fresh: [string, SlipWeather][]) {
  for (let i = 0; i < fresh.length; i += 25) {
    const metafields = fresh.slice(i, i + 25).map(([id, w]) => ({
      ownerId: `gid://shopify/Order/${id}`,
      namespace: METAFIELD_NAMESPACE,
      key: METAFIELD_FORECAST_KEY,
      type: "json",
      value: JSON.stringify(w),
    }));
    try {
      const data = await query<{ metafieldsSet: { userErrors: { message: string }[] } }>(
        admin,
        SAVE_FORECASTS,
        { metafields },
      );
      const errs = data.metafieldsSet.userErrors;
      if (errs.length) console.warn("[slip-weather] save:", errs.map((e) => e.message).join("; "));
    } catch (err) {
      console.warn("[slip-weather] save failed:", err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Destination forecast for each order being printed, keyed by numeric
 * order ID.
 *
 * One weather lookup per order, ever: the first print fetches the forecast
 * (from today at the destination through the provider's horizon — slips
 * are printed at packing time) and saves it on the order as the
 * weather_slip.forecast metafield. Every reprint reads that back: no API
 * call, no usage, the same slip every time.
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
  admin: GraphqlClient,
  now = new Date(),
): Promise<Map<string, SlipWeather>> {
  const provider = providerFor();
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
  const fresh: [string, SlipWeather][] = [];

  await Promise.all(
    orders.map(async (order, i) => {
      const id = ids[i]!;
      // Printed before: reuse the forecast saved on the order.
      const saved = parseSavedSlipWeather(order.savedForecast?.value);
      if (saved) {
        out.set(id, saved);
        return;
      }
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
        const w: SlipWeather = {
          status: "ok",
          ...place,
          dispatch,
          delivery,
          ...slipForecast(forecast, destinationToday(forecast, now), provider.horizonDays),
          asOf: now.toISOString(),
          source: provider.id,
        };
        out.set(id, w);
        fresh.push([id, w]);
      } catch (err) {
        console.error("[slip-weather]", id, err instanceof Error ? err.message : err);
        notifyAdminLater(
          "slip-weather-failed",
          "Slips are printing without weather",
          `Weather lookup failed while printing order ${id} on ${shop.shop}: ${err instanceof Error ? err.message : String(err)}`,
        );
        out.set(id, { status: "error", ...place, dispatch, delivery });
      }
    }),
  );
  if (fresh.length) await saveForecasts(admin, fresh);
  return out;
}
