import { describe, expect, it } from "vitest";
import {
  allowedView,
  annualSavingPct,
  billingName,
  intervalFromBillingName,
  PLANS,
  planFromBillingName,
  planSlipOptions,
} from "../app/lib/plans";
import { DEFAULT_SLIP_OPTIONS, renderPackingSlips, weatherTip, weatherWarnings, type SlipDesign, type SlipOptions } from "../app/lib/slip";
import { conditionLabel, slipStrings } from "../app/lib/slip-i18n";
import { barcodeSvg, code128Values, CODE128_PATTERNS, qrSvg } from "../app/lib/order-code";
import { parseTemplateRequest } from "../app/lib/template-request";
import { sampleSlipData } from "../app/lib/slip-sample";

const { shop, order, weather } = sampleSlipData("2026-10-12", "Green Leaf Co");
const render = (design: Partial<SlipDesign> = {}, rest: Partial<SlipOptions> = {}) =>
  renderPackingSlips(shop, [order], weather, {
    unit: "C",
    timeZone: "UTC",
    nonce: "n",
    chrome: false,
    slip: { ...DEFAULT_SLIP_OPTIONS, ...rest, design: { ...DEFAULT_SLIP_OPTIONS.design, ...design } },
  });

describe("plan gates", () => {
  const fancy: SlipOptions = {
    ...DEFAULT_SLIP_OPTIONS,
    template: "LABEL_4X6",
    design: { ...DEFAULT_SLIP_OPTIONS.design, language: "de", showDistance: true, showBranding: false },
  };

  it("templates unlock one per plan: 1 / 2 / 3 / 4", () => {
    expect(PLANS.FREE.templates).toEqual(["CLASSIC"]);
    expect(PLANS.STARTER.templates).toHaveLength(2);
    expect(PLANS.PRO.templates).toHaveLength(3);
    expect(PLANS.BUSINESS.templates).toHaveLength(4);
  });

  it("clamps what a plan doesn't include, keeps what it does", () => {
    const free = planSlipOptions(fancy, "FREE");
    expect(free.template).toBe("CLASSIC");
    expect(free.design.language).toBe("en");
    expect(free.design.showDistance).toBe(false);
    expect(free.design.showBranding).toBe(true);

    const pro = planSlipOptions(fancy, "PRO");
    expect(pro.template).toBe("CLASSIC"); // the label is Business
    expect(pro.design.language).toBe("de");
    expect(pro.design.showDistance).toBe(true);
    expect(pro.design.showBranding).toBe(true); // only Business hides the mark

    const biz = planSlipOptions(fancy, "BUSINESS");
    expect(biz.template).toBe("LABEL_4X6");
    expect(biz.design.showBranding).toBe(false);
  });

  it("Free and Starter only open the Unfulfilled view", () => {
    expect(allowedView("all", "FREE")).toBe("unfulfilled");
    expect(allowedView("cancelled", "STARTER")).toBe("unfulfilled");
    expect(allowedView("cancelled", "PRO")).toBe("cancelled");
  });

  it("only Business may hide the Weather Slip mark", () => {
    expect(render({ showBranding: false })).not.toContain('class="ws-mark"');
    expect(render()).toContain('class="ws-mark"');
  });
});

describe("yearly billing", () => {
  it("round-trips plan and interval through the subscription name", () => {
    expect(billingName("PRO", "ANNUAL")).toBe("Pro (yearly)");
    expect(planFromBillingName("Pro (yearly)")).toBe("PRO");
    expect(intervalFromBillingName("Pro (yearly)")).toBe("ANNUAL");
    expect(intervalFromBillingName("Pro")).toBe("MONTHLY");
  });
  it("yearly is cheaper than 12 months", () => {
    for (const id of ["STARTER", "PRO", "BUSINESS"] as const) {
      expect(PLANS[id].annualPriceUsd).toBeLessThan(PLANS[id].priceUsd * 12);
      expect(annualSavingPct(id)).toBeGreaterThan(10);
    }
  });
});

describe("slip language", () => {
  it("prints labels, dates and conditions in the chosen language", () => {
    const html = render({ language: "de" });
    expect(html).toContain('<html lang="de">');
    expect(html).toContain("Lieferschein");
    expect(html).toContain("Lieferadresse");
    expect(html).toContain("Leichter Regen"); // "Light rain"
    expect(html).not.toContain("Ship to");
  });
  it("maps provider labels, leaves unknown ones as written", () => {
    expect(conditionLabel("Moderate rain", "fr")).toBe("Pluie");
    expect(conditionLabel("Overcast clouds", "es")).toBe("Cubierto");
    expect(conditionLabel("Thunderstorm, hail", "it")).toBe("Temporale con grandine");
    expect(conditionLabel("Something new", "nl")).toBe("Something new");
    expect(conditionLabel("Light rain", "en")).toBe("Light rain");
  });
});

describe("bad weather", () => {
  it("warns on ≥60% rain, freezing or very hot", () => {
    expect(weatherWarnings({ minC: 5, maxC: 20, precipProb: 60 })).toEqual(["rain"]);
    expect(weatherWarnings({ minC: -1, maxC: 3, precipProb: 10 })).toEqual(["freezing"]);
    expect(weatherWarnings({ minC: 24, maxC: 38, precipProb: null })).toEqual(["hot"]);
    expect(weatherWarnings({ minC: 5, maxC: 20, precipProb: 59 })).toEqual([]);
  });
  it("badges only dispatch/delivery days and adds a delivery-day tip", () => {
    // Sample: delivery day has 75% rain; the 70% day isn't a key day.
    const html = render();
    expect(html.match(/class="warn w-rain"/g)).toHaveLength(1);
    expect(html).toContain("Rain expected on delivery day");
    expect(render({ showTip: false })).not.toContain("Rain expected on delivery day");
    const t = slipStrings("en");
    expect(weatherTip(t, { status: "no_location", city: null, countryCode: null, dispatch: "x", delivery: "y" })).toBeNull();
  });
  it("says what the percentage means", () => {
    expect(render()).toContain("75% chance of rain");
  });
});

describe("slip layout options", () => {
  it("dispatch-to-delivery only drops the other days", () => {
    const all = render().match(/class="day[ "]/g)!.length;
    const trip = render({ forecastRange: "trip" }).match(/class="day[ "]/g)!.length;
    expect(all).toBe(5);
    expect(trip).toBe(3); // dispatch (day 1) → delivery (day 3)
  });
  it("no product images: no image column, no placeholder text", () => {
    const html = render();
    expect(html).not.toContain("No image");
    expect(html).not.toContain('class="img"');
  });
  it("Minimal uses no filled warning badges", () => {
    expect(render({}, { template: "MINIMAL" })).toContain(".warn { background: none !important; }");
  });
  it("prints a QR code or barcode of the order number when chosen", () => {
    expect(render({ orderCode: "qr" })).toContain('class="ocode qr"');
    expect(render({ orderCode: "barcode" })).toContain('class="ocode bc"');
    expect(render()).not.toContain('class="ocode');
  });
});

describe("order codes", () => {
  it("Code 128 table is well formed", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.forEach((p, i) => {
      const sum = [...p].reduce((n, c) => n + Number(c), 0);
      expect(sum).toBe(i === 106 ? 13 : 11);
    });
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
  });
  // 104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7 = 879; 879 mod 103 = 55.
  it("Code 128-B checksum is weighted by position, mod 103", () => {
    const v = code128Values("PJJ123C")!;
    expect(v[0]).toBe(104);
    expect(v.at(-2)).toBe(55);
    expect(v.at(-1)).toBe(106);
  });
  it("refuses what it can't encode", () => {
    expect(barcodeSvg("#1042 ✓")).toBe("");
    expect(barcodeSvg("#1042")).toContain("<svg");
  });
  it("QR is one dark path, no style attributes", () => {
    const svg = qrSvg("#1042");
    expect(svg).toMatch(/<path d="M/);
    expect(svg).not.toContain("style=");
  });
});

describe("template requests", () => {
  it("validates the form", () => {
    expect(parseTemplateRequest({ description: "short", contactEmail: "a@b.co" }).ok).toBe(false);
    expect(
      parseTemplateRequest({ description: "x".repeat(30), contactEmail: "a@b.co", referenceUrl: "javascript:alert(1)" }).ok,
    ).toBe(false);
    expect(parseTemplateRequest({ description: "x".repeat(30), contactEmail: "nope" }).ok).toBe(false);
    const ok = parseTemplateRequest({
      description: "  A 4x6 label with our gift note on the back  ",
      contactEmail: "ops@shop.example",
      referenceUrl: "",
    });
    expect(ok).toEqual({
      ok: true,
      data: { description: "A 4x6 label with our gift note on the back", referenceUrl: null, contactEmail: "ops@shop.example" },
    });
  });
});

describe("Flow action payload", async () => {
  const { flowOrderId } = await import("../app/lib/flow-action");
  it("reads the order id however Flow sends it", () => {
    expect(flowOrderId({ properties: { order_id: 5432109876 } })).toBe("5432109876");
    expect(flowOrderId({ properties: { order_id: "gid://shopify/Order/123" } })).toBe("123");
    expect(flowOrderId({ properties: {} })).toBeNull();
    expect(flowOrderId({ properties: { order_id: "1; drop" } })).toBeNull();
  });
});

describe("watermark", () => {
  const wm = (design: Partial<SlipDesign>): SlipOptions => ({
    ...DEFAULT_SLIP_OPTIONS,
    design: { ...DEFAULT_SLIP_OPTIONS.design, ...design },
  });
  const logo = "https://cdn.shopify.com/s/files/logo.png";

  it("is tiered: Free none, Starter presets, Pro any text, Business logo", () => {
    const paid = wm({ watermark: "text", watermarkText: "PAID" });
    const custom = wm({ watermark: "text", watermarkText: "Handmade with love" });
    const logoWm = wm({ watermark: "logo", logoUrl: logo });
    expect(planSlipOptions(paid, "FREE").design.watermark).toBe("none");
    expect(planSlipOptions(paid, "STARTER").design.watermark).toBe("text");
    expect(planSlipOptions(custom, "STARTER").design.watermark).toBe("none");
    expect(planSlipOptions(custom, "PRO").design.watermark).toBe("text");
    expect(planSlipOptions(logoWm, "PRO").design.watermark).toBe("none");
    expect(planSlipOptions(logoWm, "BUSINESS").design.watermark).toBe("logo");
  });

  it("renders text or logo behind the page, escaped, no inline styles", () => {
    const text = render({ watermark: "text", watermarkText: "<b>PAID</b>" });
    expect(text).toContain('<div class="wm" aria-hidden="true"><span>&lt;b&gt;PAID&lt;/b&gt;</span></div>');
    const img = render({ watermark: "logo", logoUrl: logo });
    expect(img).toContain(`class="wm-logo" src="${logo}"`);
    expect(render({ watermark: "logo", logoUrl: null })).not.toContain('class="wm"');
    expect(render({ watermark: "text", watermarkText: "PAID", watermarkAngle: "flat" })).toContain("--wm-rot: 0deg");
    expect(text).not.toMatch(/<div class="wm"[^>]*style=/);
  });
});

describe("plan cards", () => {
  it("list included features first, then the rest, keeping order", async () => {
    const { planFeatures } = await import("../app/lib/plans");
    for (const id of ["FREE", "STARTER", "PRO", "BUSINESS"] as const) {
      const f = planFeatures(id);
      const firstMissing = f.findIndex((x) => !x.included);
      if (firstMissing >= 0) expect(f.slice(firstMissing).every((x) => !x.included)).toBe(true);
      expect(f[0]!.text).toContain("slip prints/month");
    }
  });
});
