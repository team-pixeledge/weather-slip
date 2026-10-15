import { describe, expect, it } from "vitest";
import { planFeatures, planFromBillingName, PLANS } from "../app/lib/plans";
import { DEFAULT_SLIP_OPTIONS, renderPackingSlips, resolveLogo, sanitizeDesign, type SlipOptions } from "../app/lib/slip";
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

  it("sample preview dates follow the shop's shipping days and weekday setting", () => {
    // Thursday order, handling 1 + transit 2: Fri dispatch, Tue delivery when
    // weekends are skipped — never Sunday.
    const w = sampleSlipData("2026-10-15", "x", { handlingDays: 1, transitDays: 2, skipWeekends: true })
      .weather.get("1")!;
    expect([w.dispatch, w.delivery]).toEqual(["2026-10-16", "2026-10-20"]);
    const plain = sampleSlipData("2026-10-15", "x", { handlingDays: 1, transitDays: 2, skipWeekends: false })
      .weather.get("1")!;
    expect(plain.delivery).toBe("2026-10-18");
  });

  it("breaks between slips only, never after the last (no blank page)", () => {
    // The mark and script follow the last .page, so a break-after on
    // .page with a :last-child exception still broke after it.
    const html = render({ template: "CLASSIC" });
    expect(html).not.toMatch(/break-after:\s*page/);
    expect(html).toContain(".page + .page { break-before: page; }");
  });
});

describe("plans", () => {
  it("lists every feature on every card, marking what's included", () => {
    const free = planFeatures("FREE");
    const pro = planFeatures("PRO");
    const business = planFeatures("BUSINESS");
    expect(free.length).toBe(business.length);
    expect(free.find((f) => f.text.includes("Dispatch-day"))!.included).toBe(false);
    // Every step up adds something; only Business has everything.
    const count = (id: "FREE" | "STARTER" | "PRO" | "BUSINESS") => planFeatures(id).filter((f) => f.included).length;
    expect(count("FREE")).toBeLessThan(count("STARTER"));
    expect(count("STARTER")).toBeLessThan(count("PRO"));
    expect(count("PRO")).toBeLessThan(count("BUSINESS"));
    expect(pro.some((f) => !f.included)).toBe(true);
    expect(business.every((f) => f.included)).toBe(true);
    // Free stores do get weather on Shopify's own packing slip.
    expect(free.find((f) => f.text.includes("Shopify's own packing slip"))!.included).toBe(true);
  });

  it("maps Billing API names back to plans", () => {
    expect(planFromBillingName("Starter")).toBe("STARTER");
    expect(planFromBillingName("Pro")).toBe("PRO");
    expect(planFromBillingName("Business")).toBe("BUSINESS");
    expect(planFromBillingName("Free")).toBeNull();
    expect(planFromBillingName("Something else")).toBeNull();
  });

  it("each card lists its own order allowance", () => {
    for (const id of ["FREE", "STARTER", "PRO", "BUSINESS"] as const) {
      expect(planFeatures(id)[0]!.text).toContain(PLANS[id].ordersPerPeriod.toLocaleString("en-US"));
    }
  });
});

describe("slip design", () => {
  const withDesign = (design: Partial<import("../app/lib/slip").SlipDesign>, rest: Partial<SlipOptions> = {}) =>
    render({ ...rest, design: { ...DEFAULT_SLIP_OPTIONS.design, ...design } });

  it("only accepts logos from Shopify's CDN", () => {
    expect(sanitizeDesign({ logoUrl: "https://evil.example/x.png" }).logoUrl).toBeNull();
    expect(sanitizeDesign({ logoUrl: 'https://cdn.shopify.com/a.png" onerror="x' }).logoUrl).toBeNull();
    expect(sanitizeDesign({ logoUrl: "https://cdn.shopify.com/s/files/logo.png" }).logoUrl).toBe(
      "https://cdn.shopify.com/s/files/logo.png",
    );
  });

  it("rejects bad colours and unknown values, keeps old font names working", () => {
    const d = sanitizeDesign({ accent: "red; background:url(x)", fontSize: "HUGE", font: "serif" });
    expect(d.accent).toBe("#111111");
    expect(d.fontSize).toBe("M");
    expect(d.font).toBe("georgia");
  });

  it("places the logo and applies title, note, accent and font", () => {
    const html = withDesign({
      logoUrl: "https://cdn.shopify.com/s/files/logo.png",
      logoPosition: "center",
      title: "Your order",
      headerNote: "Open on arrival",
      accent: "#1f6fdb",
      font: "georgia",
    });
    expect(html).toContain('class="logo-center"');
    expect(html).toContain("<h1>Your order</h1>");
    expect(html).toContain("Open on arrival");
    expect(html).toContain("--accent: #1f6fdb");
    expect(html).toContain("Georgia");
  });

  it("switches weather parts, contact lines, item count and footer parts", () => {
    const html = withDesign({
      showWeather: false,
      showEmail: true,
      showPaymentStatus: true,
      showStoreAddress: false,
      footerExtra: "Returns within 30 days",
    });
    expect(html).not.toContain('class="day');
    expect(html).toContain("Dispatch:"); // dates stay on their own
    expect(html).toContain("jordan.lee@example.com");
    expect(html).toContain("Payment:</strong> Paid");
    expect(html).toContain("Order details · 3 items");
    expect(html).not.toContain("12 Market Street");
    expect(html).toContain("Returns within 30 days");
  });

  it("prints every paper format and both label sizes", () => {
    expect(render({ paper: "A5" })).toContain("size: A5");
    expect(render({ paper: "LEGAL" })).toContain("size: legal");
    expect(withDesign({ labelSize: "4x4" }, { template: "LABEL_4X6" })).toContain("size: 4in 4in");
  });
});

describe("logo source", () => {
  const brand = "https://cdn.shopify.com/s/files/brand.png";
  const custom = "https://cdn.shopify.com/s/files/custom.png";
  it("uses the store logo by default, a custom link, or none", () => {
    const d = sanitizeDesign({});
    expect(d.logoSource).toBe("store");
    expect(resolveLogo(d, brand).logoUrl).toBe(brand);
    expect(resolveLogo(sanitizeDesign({ logoSource: "custom", logoUrl: custom }), brand).logoUrl).toBe(custom);
    expect(resolveLogo(sanitizeDesign({ logoSource: "none", logoUrl: custom }), brand).logoUrl).toBeNull();
  });
  it("treats an older save with a custom link as custom", () => {
    expect(sanitizeDesign({ logoUrl: custom }).logoSource).toBe("custom");
  });
  it("never prints a non-Shopify store logo", () => {
    expect(resolveLogo(sanitizeDesign({}), "https://evil.example/x.png").logoUrl).toBeNull();
  });
});

describe("line items", () => {
  const withDesign = (design: Partial<import("../app/lib/slip").SlipDesign>, rest: Partial<SlipOptions> = {}) =>
    render({ ...rest, design: { ...DEFAULT_SLIP_OPTIONS.design, ...design } });

  it("shortens long titles and puts the variant on its own line", () => {
    const html = withDesign({ titleMax: 30 });
    expect(html).toContain("Live plant — Monstera delicio…");
    expect(html).not.toContain("hand-thrown");
    expect(html).toContain('<div class="muted">Large</div>');
  });

  it("shows vendor, barcode, properties and cart attributes when on", () => {
    const html = withDesign({ showVendor: true, showBarcode: true });
    expect(html).toContain("Vendor: Green Leaf Nursery");
    expect(html).toContain("Barcode: 0123456789012");
    expect(html).toContain("Gift wrap: Yes");
    expect(html).toContain("Happy birthday, Sam!");
    const off = withDesign({ showProperties: false, showCartAttributes: false });
    expect(off).not.toContain("Gift wrap");
    expect(off).not.toContain("Happy birthday");
  });

  it("prices on any template, compare-at struck through, totals optional", () => {
    const html = withDesign({ showPrices: true, showTotals: true });
    expect(html).toContain('<s class="was">$64.00</s> $54.00');
    expect(html).toContain("$100.22");
    expect(withDesign({ showPrices: true, showCompareAt: false })).not.toContain('class="was"');
    expect(render({})).not.toContain("$54.00");
  });

  it("quantity format and sorting", () => {
    expect(withDesign({ qtyFormat: "plain" })).toMatch(/class="qty">2</);
    const byName = withDesign({ itemSort: "name" });
    expect(byName.indexOf("Live plant")).toBeLessThan(byName.indexOf("Organic"));
  });
});

describe("logo size", () => {
  const logo = "https://cdn.shopify.com/s/files/logo.png";
  it("uses the chosen pixel height and width cap, clamped", () => {
    const d = sanitizeDesign({ logoSource: "custom", logoUrl: logo, logoHeight: 120, logoMaxWidth: 300 });
    const html = render({ design: d });
    expect(html).toContain("--logo-h: 120px; --logo-w: 300px;");
    expect(sanitizeDesign({ logoHeight: 5000 }).logoHeight).toBe(200);
    expect(sanitizeDesign({ logoHeight: "abc" }).logoHeight).toBe(56);
  });
  it("maps the old Small/Medium/Large setting", () => {
    expect(sanitizeDesign({ logoSize: "L" }).logoHeight).toBe(80);
  });
  it("halves it on shipping labels", () => {
    const d = sanitizeDesign({ logoSource: "custom", logoUrl: logo, logoHeight: 80 });
    expect(render({ template: "LABEL_4X6", design: d })).toContain("--logo-h: 40px;");
  });
});

describe("theme logo lookup", () => {
  it("finds the header logo in settings_data.json (with Shopify's comment header)", async () => {
    const { findThemeLogoRef } = await import("../app/lib/brand-logo.server");
    const json = `/*\n * auto-generated\n */\n${JSON.stringify({
      current: {
        sections: {
          header: { settings: { logo: "shopify://shop_images/acme-logo.png", logo_width: 120 } },
          footer: { settings: { footer_logo: "shopify://shop_images/small.png" } },
        },
      },
    })}`;
    expect(findThemeLogoRef(json)).toBe("shopify://shop_images/acme-logo.png");
  });
  it("follows a preset name in current", async () => {
    const { findThemeLogoRef } = await import("../app/lib/brand-logo.server");
    const json = JSON.stringify({ current: "Default", presets: { Default: { logo: "shopify://shop_images/p.png" } } });
    expect(findThemeLogoRef(json)).toBe("shopify://shop_images/p.png");
    expect(findThemeLogoRef("{}")).toBeNull();
  });
});

describe("print-page CSP", () => {
  it("never relies on inline style attributes (the print CSP drops them)", () => {
    const d = sanitizeDesign({
      logoSource: "custom",
      logoUrl: "https://cdn.shopify.com/s/files/logo.png",
      showPrices: true,
      showTotals: true,
    });
    for (const template of ["CLASSIC", "MINIMAL", "DETAILED", "LABEL_4X6"] as const) {
      expect(render({ template, design: d })).not.toMatch(/\sstyle="/);
    }
  });
});
