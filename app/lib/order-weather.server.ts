import type { OrderWeatherSnapshot, Prisma, Shop, SnapshotStatus, WeatherJob } from "@prisma/client";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  METAFIELD_NAMESPACE,
  METAFIELD_SNAPSHOT_KEY,
  METAFIELD_SUMMARY_KEY,
} from "./constants";
import { addWorkingDays, daysBetween, localDate, shippingDates } from "./dates";
import { locationKey } from "./location";
import { planShippingDays, PLANS } from "./plans";
import { displaySettings, ensureShop, isCounted, providerFor } from "./shop.server";
import {
  buildSnapshot,
  destinationToday,
  fillPendingDays,
  hasPendingDays,
  nextFillDate,
} from "./snapshot";
import { cachedForecast, cachedGeocode } from "./weather/cache.server";
import type { GeoPoint, WeatherSnapshot } from "./weather/types";
import { query } from "./orders.server";

type AdminClient = Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];

// Only the address fields needed to locate the weather — no name, street,
// phone or email (protected customer data: request the minimum).
const ORDER_QUERY = `#graphql
  query OrderForWeather($id: ID!) {
    shop { ianaTimezone }
    order(id: $id) {
      id
      name
      createdAt
      shippingAddress { latitude longitude city zip countryCodeV2 }
      fulfillments(first: 5) { createdAt estimatedDeliveryAt }
    }
  }`;

const SET_METAFIELDS = `#graphql
  mutation SetOrderWeather($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message code }
    }
  }`;

interface OrderData {
  shop: { ianaTimezone: string };
  order: {
    id: string;
    name: string;
    createdAt: string;
    shippingAddress: {
      latitude: number | null;
      longitude: number | null;
      city: string | null;
      zip: string | null;
      countryCodeV2: string | null;
    } | null;
    fulfillments: { createdAt: string; estimatedDeliveryAt: string | null }[];
  } | null;
}

export const orderGid = (orderId: string) => `gid://shopify/Order/${orderId}`;

/** Dispatch and delivery dates for an order, in the shop's timezone. */
export function orderShippingDates(
  order: {
    createdAt: string;
    fulfillments: { createdAt: string; estimatedDeliveryAt: string | null }[];
  },
  shop: Shop,
  now = new Date(),
) {
  const fulfillment = order.fulfillments[0];
  const tz = shop.timezone;
  return shippingDates(
    {
      orderDate: localDate(new Date(order.createdAt), tz),
      today: localDate(now, tz),
      fulfilledDate: fulfillment ? localDate(new Date(fulfillment.createdAt), tz) : null,
      estimatedDeliveryDate: fulfillment?.estimatedDeliveryAt
        ? localDate(new Date(fulfillment.estimatedDeliveryAt), tz)
        : null,
    },
    // Fixed by the plan (planShippingDays), not Shop.handlingDays/transitDays.
    planShippingDays(shop),
  );
}

// Keeps partial data: until protected customer data (Address) is granted,
// Shopify refuses latitude/longitude with an error but still returns the
// city/zip/country, which the geocoder can use instead.
function fetchOrder(admin: AdminClient, orderId: string): Promise<OrderData> {
  return query<OrderData>(admin, ORDER_QUERY, { id: orderGid(orderId) });
}

async function writeMetafields(
  admin: AdminClient,
  orderId: string,
  snap: WeatherSnapshot,
): Promise<void> {
  const res = await admin.graphql(SET_METAFIELDS, {
    variables: {
      metafields: [
        {
          ownerId: orderGid(orderId),
          namespace: METAFIELD_NAMESPACE,
          key: METAFIELD_SUMMARY_KEY,
          type: "single_line_text_field",
          value: snap.summary,
        },
        {
          ownerId: orderGid(orderId),
          namespace: METAFIELD_NAMESPACE,
          key: METAFIELD_SNAPSHOT_KEY,
          type: "json",
          value: JSON.stringify(snap),
        },
      ],
    },
  });
  const json = (await res.json()) as {
    data?: { metafieldsSet: { userErrors: { message: string }[] } };
  };
  const errors = json.data?.metafieldsSet.userErrors ?? [];
  if (!json.data || errors.length) {
    throw new Error(`metafieldsSet failed: ${errors.map((e) => e.message).join("; ")}`);
  }
}

async function latestSnapshot(shop: string, orderId: string) {
  return prisma.orderWeatherSnapshot.findFirst({
    where: { shop, orderId },
    orderBy: { version: "desc" },
  });
}

async function saveVersion(
  prev: OrderWeatherSnapshot | null,
  data: Omit<Prisma.OrderWeatherSnapshotUncheckedCreateInput, "version">,
) {
  // A new version supersedes the old one's pending-fill schedule.
  if (prev?.nextFillAt) {
    await prisma.orderWeatherSnapshot.update({
      where: { id: prev.id },
      data: { nextFillAt: null },
    });
  }
  return prisma.orderWeatherSnapshot.create({
    data: { ...data, version: (prev?.version ?? 0) + 1, frozenAt: prev?.frozenAt ?? null },
  });
}

function statusFor(snap: WeatherSnapshot): SnapshotStatus {
  return hasPendingDays(snap) ? "PENDING_DATES" : "OK";
}

/** Run one queued job end to end. Throws to trigger the queue's retry. */
export async function processJob(job: WeatherJob, now = new Date()): Promise<void> {
  const shop = await prisma.shop.findUnique({ where: { shop: job.shop } });
  if (!shop || shop.uninstalledAt) return; // nothing to do for a gone shop

  const prev = await latestSnapshot(job.shop, job.orderId);

  // CREATE comes from the first print of an order; a duplicate (two prints
  // before the job ran) must not overwrite what's already saved.
  if (job.reason === "CREATE" && prev) return;
  if (job.reason === "PENDING_FILL" && prev?.status !== "PENDING_DATES") return;
  if (job.reason === "ADDRESS_CHANGE" && prev?.frozenAt) return;

  const { admin } = await unauthenticated.admin(job.shop);
  const data = await fetchOrder(admin, job.orderId);
  const order = data.order;
  if (!order) return; // deleted

  const current = await ensureShop(job.shop, data.shop.ianaTimezone);
  const addr = order.shippingAddress;
  const locKey = addr
    ? locationKey({
        latitude: addr.latitude,
        longitude: addr.longitude,
        city: addr.city,
        zip: addr.zip,
        countryCode: addr.countryCodeV2,
      })
    : null;

  if (job.reason === "ADDRESS_CHANGE" && prev && prev.locationKey === locKey) return;

  const base = {
    shop: job.shop,
    orderId: job.orderId,
    orderName: order.name,
    locationKey: locKey,
    city: addr?.city ?? null,
    countryCode: addr?.countryCodeV2 ?? null,
  };

  if (!addr || !locKey) {
    await saveVersion(prev, { ...base, status: "NO_LOCATION" });
    return;
  }

  // Plans count prints, not API calls, and jobs never use plan units: the
  // print (chargePrint) or Flow (markCounted) lists the order before
  // queueing CREATE/REFRESH. Address changes and pending fills only ever
  // update an order that's already listed.
  const counted = await isCounted(job.shop, job.orderId);
  if (!counted) {
    if (job.reason === "ADDRESS_CHANGE" || job.reason === "PENDING_FILL") return;
    await saveVersion(prev, { ...base, status: "LIMIT_REACHED" });
    return;
  }

  const provider = providerFor();
  let point: GeoPoint | null =
    addr.latitude != null && addr.longitude != null
      ? { lat: addr.latitude, lon: addr.longitude }
      : null;
  if (!point && (addr.city || addr.zip)) {
    point = await cachedGeocode(
      provider,
      { city: addr.city ?? "", zip: addr.zip, countryCode: addr.countryCodeV2 },
      now,
    );
  }
  if (!point) {
    await saveVersion(prev, { ...base, status: "NO_LOCATION" });
    return;
  }

  const forecast = await cachedForecast(provider, point, now);
  const today = destinationToday(forecast, now);
  const settings = displaySettings(current);
  // The plan decides how far ahead the saved summary may reach — in
  // weekdays when the shop counts weekdays only, like the slip's forecast.
  const daysAhead = PLANS[current.plan].forecastDaysAhead;
  const horizon = Math.min(
    provider.horizonDays,
    daysBetween(today, addWorkingDays(today, daysAhead, current.skipWeekends)),
  );
  // Retry pending days on the calendar-day window: never later than the
  // weekday window would let them in.
  const fillHorizon = Math.min(provider.horizonDays, daysAhead);

  let snap: WeatherSnapshot;
  if (job.reason === "PENDING_FILL" && prev?.payload) {
    snap = fillPendingDays(
      prev.payload as unknown as WeatherSnapshot,
      forecast,
      today,
      horizon,
      settings,
    );
  } else {
    const dates = orderShippingDates(order, current, now);
    snap = buildSnapshot({
      forecast,
      horizonDays: horizon,
      point,
      city: addr.city,
      countryCode: addr.countryCodeV2,
      ...dates,
      today,
      settings,
      dispatchAllowed: PLANS[current.plan].dispatchForecast,
      now,
    });
  }

  await writeMetafields(admin, job.orderId, snap);

  const fill = nextFillDate(snap, fillHorizon);
  await saveVersion(prev, {
    ...base,
    status: statusFor(snap),
    dispatchDate: snap.dispatch.date,
    deliveryDate: snap.delivery.date,
    payload: snap as unknown as Prisma.InputJsonValue,
    summary: snap.summary,
    nextFillAt: fill ? new Date(`${fill}T00:00:00Z`) : null,
  });
}

/** Freeze an order's live snapshot once it ships: no automatic changes after this. */
export async function freezeSnapshot(shop: string, orderId: string, now = new Date()) {
  const prev = await latestSnapshot(shop, orderId);
  if (prev && !prev.frozenAt) {
    await prisma.orderWeatherSnapshot.update({
      where: { id: prev.id },
      data: { frozenAt: now },
    });
  }
}

export type { Shop };
