import { describe, expect, it } from "vitest";
import { formatDistance, haversineKm } from "../app/lib/distance";
import { DEFAULT_SLIP_OPTIONS, renderPackingSlips, sanitizeDesign, type SlipOptions } from "../app/lib/slip";
import { sampleSlipData } from "../app/lib/slip-sample";

const AUSTIN = { lat: 30.2672, lon: -97.7431 };
const DENVER = { lat: 39.7392, lon: -104.9903 };

describe("distance", () => {
  it("great-circle distance", () => {
    expect(haversineKm(AUSTIN, DENVER)).toBeGreaterThan(1235);
    expect(haversineKm(AUSTIN, DENVER)).toBeLessThan(1250);
    expect(haversineKm(AUSTIN, AUSTIN)).toBe(0);
    // London → New York ≈ 5,570 km
    expect(Math.round(haversineKm({ lat: 51.5074, lon: -0.1278 }, { lat: 40.7128, lon: -74.006 }) / 10)).toBe(557);
  });

  it("formats each unit", () => {
    expect(formatDistance(1000, "km")).toBe("1,000 km");
    expect(formatDistance(1000, "mi")).toBe("621 mi");
    expect(formatDistance(1000, "nmi")).toBe("540 nmi");
    expect(formatDistance(5.04, "km")).toBe("5 km");
    expect(formatDistance(8.44, "km")).toBe("8.4 km");
  });

  it("sanitises the settings", () => {
    const d = sanitizeDesign({ showDistance: true, distanceUnit: "parsec", distanceFrom: "x; drop" });
    expect(d.showDistance).toBe(true);
    expect(d.distanceUnit).toBe("km");
    expect(d.distanceFrom).toBe("order");
    expect(sanitizeDesign({ distanceFrom: "123456" }).distanceFrom).toBe("123456");
    expect(sanitizeDesign({ distanceUnit: "nmi" }).distanceUnit).toBe("nmi");
    expect(sanitizeDesign({}).showDistance).toBe(false);
  });

  const { shop, order, weather, distance } = sampleSlipData("2026-10-12", "Green Leaf Co");
  const render = (design: Partial<SlipOptions["design"]>, template: SlipOptions["template"] = "CLASSIC") =>
    renderPackingSlips(shop, [order], weather, {
      unit: "C",
      timeZone: "UTC",
      nonce: "n",
      chrome: false,
      distance,
      slip: { ...DEFAULT_SLIP_OPTIONS, template, design: { ...DEFAULT_SLIP_OPTIONS.design, ...design } },
    });

  it("shows on the slip only when switched on, in the chosen unit", () => {
    expect(render({})).not.toContain('class="distance"');
    expect(render({ showDistance: true })).toMatch(/Distance:<\/strong> 1,2\d\d km from Austin, US/);
    expect(render({ showDistance: true, distanceUnit: "mi" })).toMatch(/77\d mi from Austin, US/);
    expect(render({ showDistance: true, distanceUnit: "nmi" })).toMatch(/67\d nmi/);
    expect(render({ showDistance: true }, "LABEL_4X6")).toContain('class="distance"');
    expect(render({ showDistance: true }, "MINIMAL")).toContain('class="distance"');
  });

  it("says when it can't be worked out", () => {
    const html = renderPackingSlips(shop, [order], weather, {
      unit: "C",
      timeZone: "UTC",
      nonce: "n",
      chrome: false,
      distance: new Map([["1", [{ status: "unavailable", reason: "no_destination" }]]]),
      slip: { ...DEFAULT_SLIP_OPTIONS, design: { ...DEFAULT_SLIP_OPTIONS.design, showDistance: true } },
    });
    expect(html).toContain("not available");
  });
});
