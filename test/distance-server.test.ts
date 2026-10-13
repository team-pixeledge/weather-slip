import { describe, expect, it, vi } from "vitest";

vi.mock("../app/lib/shop.server", () => ({ providerFor: () => ({ id: "test" }) }));
const geocode = vi.fn(async () => ({ lat: 19.076, lon: 72.8777 })); // Mumbai
vi.mock("../app/lib/weather/cache.server", () => ({ cachedGeocode: (...a: unknown[]) => geocode(...(a as [])) }));

const { distancesForSlips } = await import("../app/lib/distance.server");
import type { PrintOrder } from "../app/lib/orders.server";

const PUNE = { latitude: 18.5204, longitude: 73.8567 };
const DELHI = { latitude: 28.6139, longitude: 77.209 };
const NAGPUR = { latitude: 21.1458, longitude: 79.0882 };

const order = (id: string, addr: Partial<PrintOrder["shippingAddress"]> | null) =>
  ({ id: `gid://shopify/Order/${id}`, shippingAddress: addr }) as unknown as PrintOrder;

const fo = (status: string, city: string, coords: { latitude: number; longitude: number } | null, locId = city) => ({
  status,
  assignedLocation: { city, zip: null, countryCode: "IN", location: coords ? { id: `gid://shopify/Location/${locId}`, address: coords } : null },
});

function admin(nodes: unknown[], opts: { fail?: boolean; location?: unknown } = {}) {
  return {
    graphql: async (q: string) => {
      if (opts.fail && q.includes("SlipDistanceOrigins")) return new Response(JSON.stringify({ errors: [{ message: "Access denied" }] }));
      if (q.includes("SlipDistanceStore"))
        return new Response(JSON.stringify({ data: { shop: { shopAddress: { city: "Nagpur", zip: null, countryCodeV2: "IN", ...NAGPUR } } } }));
      if (q.includes("SlipDistanceLocation")) return new Response(JSON.stringify({ data: { location: opts.location ?? null } }));
      return new Response(
        JSON.stringify({
          data: { shop: { shopAddress: { city: "Nagpur", zip: null, countryCodeV2: "IN", ...NAGPUR } }, nodes },
        }),
      );
    },
  };
}

const shop = {} as never;
const toDelhi = order("1", { city: "New Delhi", countryCodeV2: "IN", ...DELHI });

describe("distancesForSlips", () => {
  it("uses the order's assigned location (moved FO = cancelled, ignored)", async () => {
    const m = await distancesForSlips(
      shop,
      [toDelhi],
      admin([{ id: "gid://shopify/Order/1", fulfillmentOrders: { nodes: [fo("CANCELLED", "Nagpur", NAGPUR), fo("OPEN", "Pune", PUNE)] } }]),
      "order",
    );
    const [d] = m.get("1")!;
    expect(d).toMatchObject({ status: "ok", from: "Pune, IN" });
    expect(d!.status === "ok" && Math.round(d.km)).toBeGreaterThan(1150);
  });

  it("split order → one distance per location; shipped order → where it shipped from", async () => {
    const split = await distancesForSlips(
      shop,
      [toDelhi],
      admin([{ id: "gid://shopify/Order/1", fulfillmentOrders: { nodes: [fo("OPEN", "Pune", PUNE), fo("IN_PROGRESS", "Nagpur", NAGPUR)] } }]),
      "order",
    );
    expect(split.get("1")!.map((x) => x.status === "ok" && x.from)).toEqual(["Pune, IN", "Nagpur, IN"]);
    const shipped = await distancesForSlips(
      shop,
      [toDelhi],
      admin([{ id: "gid://shopify/Order/1", fulfillmentOrders: { nodes: [fo("CLOSED", "Pune", PUNE)] } }]),
      "order",
    );
    expect(shipped.get("1")![0]).toMatchObject({ from: "Pune, IN" });
  });

  it("no location coordinates or destination coordinates → geocodes the city", async () => {
    geocode.mockClear();
    const m = await distancesForSlips(
      shop,
      [order("1", { city: "Mumbai", countryCodeV2: "IN" })],
      admin([{ id: "gid://shopify/Order/1", fulfillmentOrders: { nodes: [fo("OPEN", "Pune", null)] } }]),
      "order",
    );
    expect(geocode).toHaveBeenCalled();
    expect(m.get("1")![0]!.status).toBe("ok");
  });

  it("scopes not approved yet → store address; no destination → unavailable", async () => {
    const m = await distancesForSlips(shop, [toDelhi, order("2", null)], admin([], { fail: true }), "order");
    expect(m.get("1")![0]).toMatchObject({ status: "ok", from: "Nagpur, IN" }); // origins query failed → store address
    const m2 = await distancesForSlips(shop, [toDelhi, order("2", null)], admin([null, null]), "order");
    expect(m2.get("1")![0]).toMatchObject({ status: "ok", from: "Nagpur, IN" });
    expect(m2.get("2")![0]).toMatchObject({ status: "unavailable", reason: "no_destination" });
  });

  it("a location picked in settings overrides the order's", async () => {
    const m = await distancesForSlips(
      shop,
      [toDelhi],
      admin([{ id: "gid://shopify/Order/1", fulfillmentOrders: { nodes: [fo("OPEN", "Pune", PUNE)] } }], {
        location: { id: "gid://shopify/Location/9", address: { city: "Nagpur", zip: null, countryCode: "IN", ...NAGPUR } },
      }),
      "9",
    );
    expect(m.get("1")![0]).toMatchObject({ from: "Nagpur, IN" });
  });
});
