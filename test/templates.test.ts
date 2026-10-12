import { describe, expect, it } from "vitest";
import { planFeatures, planFromBillingName, PLANS } from "../app/lib/plans";
import { DEFAULT_SLIP_OPTIONS, renderPackingSlips, type SlipOptions } from "../app/lib/slip";
import { sampleSlipData } from "../app/lib/slip-sample";

const { shop, order, weather } = sampleSlipData("2026-10-12", "Green Leaf Co");
const render = (o: Partial<SlipOptions>) =>
  renderPackingSlips(shop, [order], weather, {
    unit: "C",
    timeZone: "UTC",
    nonce: "n",
    chrome: false,
    slip: { ...DEFAULT_SLIP_OPTIONS, ...o },
  });

describe("slip templates", () => {
  it("Classic: forecast cards, no prices", () => {
    const html = render({ template: "CLASSIC" });
    expect(html).toMatch(/class="day key"/);
    expect(html).not.toContain("$54.00");
  });

  it("Minimal: forecast table, no images", () => {
    const html = render({ template: "MINIMAL" });
    expect(html).toContain('class="fc"');
    expect(html).not.toContain('class="img"');
  });

  it("Detailed: prices, line totals and order totals", () => {
    const html = render({ template: "DETAILED" });
    expect(html).toContain("$54.00");
    expect(html).toContain("$30.00"); // 2 × $15
    expect(html).toContain("$100.22");
  });

  it("4×6 label: label page size, no billing address, no store footer", () => {
    const html = render({ template: "LABEL_4X6" });
    expect(html).toContain("size: 4in 6in");
    expect(html).not.toContain("Bill to");
    expect(html).not.toContain("12 Market Street");
  });

  it("applies paper size and the toggles", () => {
    const html = render({ paper: "LETTER", showBilling: false, showSku: false, showNote: false, footer: "" });
    expect(html).toContain("size: letter");
    expect(html).not.toContain("Bill to");
    expect(html).not.toContain("SKU:");
    expect(html).not.toContain("Order note");
    expect(html).not.toContain("Thank you for shopping");
  });

  it("escapes a custom footer", () => {
    expect(render({ footer: "<b>Hi</b>" })).toContain("&lt;b&gt;Hi&lt;/b&gt;");
  });
});

describe("plans", () => {
  it("maps Billing API names back to plans", () => {
    expect(planFromBillingName("Starter")).toBe("STARTER");
    expect(planFromBillingName("Pro")).toBe("PRO");
    expect(planFromBillingName("Free")).toBeNull();
    expect(planFromBillingName("Something else")).toBeNull();
  });

  it("each card lists its own order allowance", () => {
    for (const id of ["FREE", "STARTER", "PRO"] as const) {
      expect(planFeatures(id).join(" ")).toContain(PLANS[id].ordersPerPeriod.toLocaleString("en-US"));
    }
  });
});
