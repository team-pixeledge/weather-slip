import type { Shop } from "@prisma/client";
import { haversineKm, type LatLon, type SlipDistance } from "./distance";
import { query, type GraphqlClient, type PrintOrder } from "./orders.server";
import { providerFor } from "./shop.server";
import { cachedGeocode } from "./weather/cache.server";

// Worked out at print time from the order's *current* fulfillment location
// and shipping address, so moving an order to another location (or editing
// the address) changes the next print. Nothing is stored.

// Separate from the print query on purpose: fulfillment orders need
// read_merchant_managed_fulfillment_orders and coordinates need
// read_locations. Until a merchant approves them this query fails and the
// slip falls back to the store address — the print itself never breaks.
const ORIGINS_QUERY = `#graphql
  query SlipDistanceOrigins($ids: [ID!]!) {
    shop { shopAddress { city zip countryCodeV2 latitude longitude } }
    nodes(ids: $ids) {
      ... on Order {
        id
        fulfillmentOrders(first: 10) {
          nodes {
            status
            assignedLocation {
              city
              zip
              countryCode
              location { id address { latitude longitude } }
            }
          }
        }
      }
    }
  }`;

const STORE_QUERY = `#graphql
  query SlipDistanceStore { shop { shopAddress { city zip countryCodeV2 latitude longitude } } }`;

const LOCATION_QUERY = `#graphql
  query SlipDistanceLocation($id: ID!) {
    location(id: $id) { id address { city zip countryCode latitude longitude } }
  }`;

interface Place {
  key: string;
  city: string | null;
  zip: string | null;
  countryCode: string | null;
  lat: number | null;
  lon: number | null;
}

interface OriginsData {
  shop: {
    shopAddress: {
      city: string | null;
      zip: string | null;
      countryCodeV2: string | null;
      latitude: number | null;
      longitude: number | null;
    } | null;
  } | null;
  nodes: ({
    id: string;
    fulfillmentOrders?: {
      nodes: {
        status: string;
        assignedLocation: {
          city: string | null;
          zip: string | null;
          countryCode: string | null;
          location: { id: string; address: { latitude: number | null; longitude: number | null } | null } | null;
        } | null;
      }[];
    } | null;
  } | null)[];
}

const numericId = (gid: string) => gid.slice(gid.lastIndexOf("/") + 1);

/**
 * Where an order ships from: the locations of its live fulfillment orders
 * (an order split across warehouses has several). Already-shipped orders
 * use the locations they shipped from; cancelled fulfillment orders (moved
 * to another location) never count.
 */
function orderOrigins(fos: NonNullable<OriginsData["nodes"][number]>["fulfillmentOrders"]): Place[] {
  const all = fos?.nodes ?? [];
  const live = all.filter((f) => f.status !== "CLOSED" && f.status !== "CANCELLED");
  const pick = live.length ? live : all.filter((f) => f.status === "CLOSED");
  const out = new Map<string, Place>();
  for (const f of pick) {
    const a = f.assignedLocation;
    if (!a) continue;
    const key = a.location?.id ?? `${a.countryCode}:${a.zip}:${a.city}`;
    if (out.has(key)) continue;
    out.set(key, {
      key,
      city: a.city,
      zip: a.zip,
      countryCode: a.countryCode,
      lat: a.location?.address?.latitude ?? null,
      lon: a.location?.address?.longitude ?? null,
    });
  }
  return [...out.values()];
}

/** Distances for each order being printed, keyed by numeric order ID. */
export async function distancesForSlips(
  shop: Shop,
  orders: PrintOrder[],
  admin: GraphqlClient,
  from: string,
  now = new Date(),
): Promise<Map<string, SlipDistance[]>> {
  const provider = providerFor(shop);
  // One geocode per place per print run (and cached 30 days across runs).
  const geo = new Map<string, Promise<LatLon | null>>();
  const pointOf = (p: { city: string | null; zip: string | null; countryCode: string | null; lat: number | null; lon: number | null }) => {
    if (p.lat != null && p.lon != null) return Promise.resolve({ lat: p.lat, lon: p.lon });
    if (!p.city && !p.zip) return Promise.resolve(null);
    const k = `${p.countryCode}:${p.zip}:${p.city}`;
    let g = geo.get(k);
    if (!g) {
      g = cachedGeocode(provider, { city: p.city ?? "", zip: p.zip, countryCode: p.countryCode }, now).catch(() => null);
      geo.set(k, g);
    }
    return g;
  };

  let data: OriginsData | null = null;
  try {
    data = await query<OriginsData>(admin, ORIGINS_QUERY, { ids: orders.map((o) => o.id) });
  } catch (err) {
    console.warn("[distance] origins:", err instanceof Error ? err.message : err);
    // Fulfillment orders not readable at all: still measure from the store.
    try {
      data = await query<OriginsData>(admin, STORE_QUERY, {});
    } catch {
      /* no origin → "not available" */
    }
  }
  const sa = data?.shop?.shopAddress ?? null;
  const storePlace: Place | null = sa
    ? { key: "store", city: sa.city, zip: sa.zip, countryCode: sa.countryCodeV2, lat: sa.latitude, lon: sa.longitude }
    : null;

  // A location chosen in the slip settings overrides each order's own.
  let fixed: Place | null = null;
  if (from !== "order") {
    try {
      const l = await query<{
        location: { id: string; address: { city: string | null; zip: string | null; countryCode: string | null; latitude: number | null; longitude: number | null } } | null;
      }>(admin, LOCATION_QUERY, { id: `gid://shopify/Location/${from}` });
      const a = l.location?.address;
      if (a) fixed = { key: l.location!.id, city: a.city, zip: a.zip, countryCode: a.countryCode, lat: a.latitude, lon: a.longitude };
    } catch (err) {
      console.warn("[distance] location:", err instanceof Error ? err.message : err);
    }
  }

  const fosBy = new Map(
    (data?.nodes ?? []).filter((n) => n != null).map((n) => [numericId(n!.id), n!.fulfillmentOrders]),
  );

  const out = new Map<string, SlipDistance[]>();
  await Promise.all(
    orders.map(async (order) => {
      const id = numericId(order.id);
      const a = order.shippingAddress;
      const dest = a
        ? await pointOf({ city: a.city ?? null, zip: a.zip ?? null, countryCode: a.countryCodeV2 ?? null, lat: a.latitude ?? null, lon: a.longitude ?? null })
        : null;
      if (!dest) {
        out.set(id, [{ status: "unavailable", reason: "no_destination" }]);
        return;
      }
      let origins = fixed ? [fixed] : orderOrigins(fosBy.get(id));
      if (!origins.length && storePlace) origins = [storePlace];
      const list: SlipDistance[] = [];
      for (const o of origins) {
        const p = await pointOf(o);
        if (p) list.push({ status: "ok", km: haversineKm(p, dest), from: [o.city, o.countryCode].filter(Boolean).join(", ") });
      }
      out.set(id, list.length ? list : [{ status: "unavailable", reason: "no_origin" }]);
    }),
  );
  return out;
}

/** Locations for the "Measure from" picker; null until read_locations is approved. */
export async function listLocations(admin: GraphqlClient): Promise<{ id: string; name: string; place: string }[] | null> {
  try {
    const data = await query<{
      locations: { nodes: { id: string; name: string; address: { city: string | null; countryCode: string | null } }[] };
    }>(
      admin,
      `#graphql
      query SlipLocations { locations(first: 100) { nodes { id name address { city countryCode } } } }`,
      {},
    );
    return data.locations.nodes.map((l) => ({
      id: numericId(l.id),
      name: l.name,
      place: [l.address.city, l.address.countryCode].filter(Boolean).join(", "),
    }));
  } catch (err) {
    console.warn("[distance] locations:", err instanceof Error ? err.message : err);
    return null;
  }
}
