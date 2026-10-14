import { describe, expect, it } from "vitest";
import type { PrintOrder, PrintShop } from "../app/lib/orders.server";
import { NO_SHIPPING_FILTER, orderSearchQuery } from "../app/lib/orders.server";
import { signPrintToken, verifyPrintToken, PRINT_TOKEN_TTL_MS } from "../app/lib/print-token.server";
import { escapeHtml, parseSavedSlipWeather, renderCustomerList, renderPackingSlips, slipForecast, type SlipWeather } from "../app/lib/slip";
import type { ForecastPayload } from "../app/lib/weather/types";

const forecast: ForecastPayload = {
  provider: "test",
  timezone: "UTC",
  current: { tempC: 21.6, code: 800, label: "Clear sky", observedAt: "2026-10-12T09:00" },
  daily: ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"].map(
    (date, i) => ({ date, minC: 10 + i, maxC: 20 + i, precipProb: i === 4 ? 70 : 5, code: 500, label: "Light rain" }),
  ),
};

describe("slipForecast", () => {
  it("keeps today through the horizon, drops past days and anything beyond", () => {
    const f = slipForecast(forecast, "2026-10-12", 4);
    expect(f.days.map((d) => d.date)).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
    ]);
    expect(f.horizonEnd).toBe("2026-10-16");
    expect(f.current).toEqual({ tempC: 21.6, label: "Clear sky" });
  });
});

describe("orderSearchQuery", () => {
  it("brackets the merchant's search so it can't widen the view", () => {
    expect(orderSearchQuery("unfulfilled", "")).toBe(
      `${NO_SHIPPING_FILTER} AND status:open AND (fulfillment_status:unfulfilled OR fulfillment_status:partial)`,
    );
    expect(orderSearchQuery("open", "x OR status:closed")).toBe(
      `${NO_SHIPPING_FILTER} AND status:open AND (x OR status:closed)`,
    );
  });
});

describe("orderSearchQuery: views and date range", () => {
  const now = new Date("2026-10-12T09:00:00Z");
  it("All orders has no status filter, but never lists POS or pickup", () => {
    expect(orderSearchQuery("all", "", "any", now)).toBe(NO_SHIPPING_FILTER);
    expect(orderSearchQuery("all", "#1001", "any", now)).toBe(`${NO_SHIPPING_FILTER} AND (#1001)`);
  });
  it("adds a created_at bound for a range", () => {
    expect(orderSearchQuery("archived", "", "180", now)).toBe(
      `${NO_SHIPPING_FILTER} AND status:closed AND created_at:>=2026-04-15`,
    );
  });
});

describe("print token", () => {
  process.env.SHOPIFY_API_SECRET = "test-secret";

  it("round-trips the shop and expires", () => {
    const now = Date.parse("2026-10-12T09:00:00Z");
    const t = signPrintToken("a.myshopify.com", now);
    expect(verifyPrintToken(t, now + 1000)).toBe("a.myshopify.com");
    expect(verifyPrintToken(t, now + PRINT_TOKEN_TTL_MS + 1)).toBeNull();
  });

  it("rejects a tampered shop", () => {
    const t = signPrintToken("a.myshopify.com");
    const [, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ shop: "b.myshopify.com", exp: Date.now() + 60_000 })).toString("base64url");
    expect(verifyPrintToken(`${forged}.${mac}`)).toBeNull();
    expect(verifyPrintToken("garbage")).toBeNull();
    expect(verifyPrintToken(null)).toBeNull();
  });
});

const shop: PrintShop = {
  name: "Fin & Co",
  contactEmail: "hello@example.com",
  ianaTimezone: "Asia/Kolkata",
  primaryDomain: { host: "fin.example.com" },
  shopAddress: { address1: "1 Harbour Rd", city: "Pune", zip: "411001", country: "India" },
};

const order: PrintOrder = {
  id: "gid://shopify/Order/1001",
  name: "#1001",
  createdAt: "2026-10-12T05:00:00Z",
  note: "Leave at <door>",
  phone: null,
  displayFulfillmentStatus: "PARTIALLY_FULFILLED",
  shippingLine: { title: "Express" },
  shippingAddress: {
    name: "Asha <script>",
    address1: "22 MG Rd",
    city: "Mumbai",
    province: "MH",
    provinceCode: "MH",
    zip: "400001",
    country: "India",
    countryCodeV2: "IN",
    phone: "+91 90000 00000",
  },
  billingAddress: null,
  fulfillments: [],
  lineItems: {
    nodes: [
      { id: "1", name: "Koi — large", sku: "KOI-L", variantTitle: "Large", quantity: 2, unfulfilledQuantity: 1, image: null },
      { id: "2", name: "Net", sku: null, variantTitle: null, quantity: 1, unfulfilledQuantity: 0, image: { url: "https://cdn.shopify.com/a.png", altText: null } },
    ],
  },
};

const weather: SlipWeather = {
  status: "ok",
  city: "Mumbai",
  countryCode: "IN",
  dispatch: "2026-10-13",
  delivery: "2026-10-18",
  ...slipForecast(forecast, "2026-10-12", 4),
  asOf: "2026-10-12T09:00:00Z",
};

describe("renderPackingSlips", () => {
  const html = renderPackingSlips(shop, [order], new Map([["1001", weather]]), {
    unit: "BOTH",
    timeZone: "Asia/Kolkata",
    nonce: "n0nce",
  });

  it("escapes order data", () => {
    expect(html).toContain(escapeHtml("Asha <script>"));
    expect(html).not.toContain("Asha <script>");
    expect(html).toContain("Leave at &lt;door&gt;");
  });

  it("prints every forecast day, marks dispatch, and notes a delivery beyond range", () => {
    expect(html.match(/class="day( key)?"/g)).toHaveLength(5);
    expect(html).toContain("Dispatch</div>");
    expect(html).toContain("beyond the forecast range");
    expect(html).toContain("°C / ");
  });

  it("lists only what is still to ship, with quantity of ordered", () => {
    expect(html).toContain("Koi — large");
    expect(html).toContain("1 of 2");
    expect(html).not.toContain(">Net<");
  });

  it("only runs nonce'd script", () => {
    expect(html.match(/<script nonce="n0nce">/g)).toHaveLength(1);
  });

  it("explains a missing forecast instead of showing one", () => {
    const limited = renderPackingSlips(
      shop,
      [order],
      new Map([["1001", { status: "limit_reached", city: "Mumbai", countryCode: "IN", dispatch: "2026-10-13", delivery: "2026-10-16" } as SlipWeather]]),
      { unit: "C", timeZone: "UTC", nonce: "x" },
    );
    expect(limited).toContain("plan limit is reached");
    expect(limited).not.toMatch(/class="day( key)?"/);
  });
});

describe("renderCustomerList", () => {
  it("lists one row per order", () => {
    const html = renderCustomerList(shop, [order, { ...order, id: "gid://shopify/Order/1002", name: "#1002" }], {
      timeZone: "UTC",
      nonce: "x",
    });
    expect(html).toContain("#1002");
    expect(html.match(/<tr>/g)).toHaveLength(3); // header + 2
  });
});

describe("saved forecast (weather_slip.forecast)", () => {
  it("round-trips, so a reprint matches the first print", () => {
    expect(parseSavedSlipWeather(JSON.stringify(weather))).toEqual(weather);
  });
  it("ignores anything malformed instead of printing it", () => {
    expect(parseSavedSlipWeather(null)).toBeNull();
    expect(parseSavedSlipWeather("not json")).toBeNull();
    expect(parseSavedSlipWeather(JSON.stringify({ ...weather, status: "limit_reached" }))).toBeNull();
    expect(parseSavedSlipWeather(JSON.stringify({ ...weather, days: [{ date: "x" }] }))).toBeNull();
  });
});
