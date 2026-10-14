import { describe, expect, it } from "vitest";
import { plansUrl, usageEmail, usageLevel } from "../app/lib/usage-alerts";

describe("usage alerts", () => {
  it("fires at 80% and 100% of the limit", () => {
    expect(usageLevel(23, 30)).toBe(0);
    expect(usageLevel(24, 30)).toBe(80);
    expect(usageLevel(29, 30)).toBe(80);
    expect(usageLevel(30, 30)).toBe(100);
    expect(usageLevel(399, 500)).toBe(0);
    expect(usageLevel(400, 500)).toBe(80);
  });

  it("links to the app's Plans page in the shop's admin", () => {
    process.env.SHOPIFY_API_KEY = "abc";
    expect(plansUrl("green-leaf.myshopify.com")).toBe(
      "https://admin.shopify.com/store/green-leaf/apps/abc/app/plans",
    );
  });

  it("writes the 80% and limit-reached emails", () => {
    const o = { shopName: "Green Leaf", planName: "Free", used: 24, limit: 30, resetsAt: "2026-11-11T00:00:00Z", url: "U", canUpgrade: true };
    const warn = usageEmail(80, o);
    expect(warn.subject).toContain("80%");
    expect(warn.text).toContain("24 of the 30 orders");
    expect(warn.text).toContain("Upgrade your plan");
    const full = usageEmail(100, { ...o, used: 30 });
    expect(full.subject).toContain("limit");
    expect(usageEmail(100, { ...o, canUpgrade: false }).text).not.toContain("Upgrade");
  });
});
