import { describe, expect, it } from "vitest";
import { pickActiveSubscription } from "../app/lib/billing.server";

const sub = (name: string, status = "ACTIVE", test = false) => ({ name, status, test });

describe("pickActiveSubscription", () => {
  it("counts a test charge Shopify made on a store it doesn't bill (review stores)", () => {
    expect(pickActiveSubscription([sub("Business", "ACTIVE", true)])?.name).toBe("Business");
  });
  it("counts a live charge", () => {
    expect(pickActiveSubscription([sub("Pro (yearly)")])?.name).toBe("Pro (yearly)");
  });
  it("ignores pending / declined charges and unknown names", () => {
    expect(pickActiveSubscription([sub("Pro", "PENDING"), sub("Business", "DECLINED"), sub("Legacy")])).toBeNull();
  });
  it("no subscription means Free", () => {
    expect(pickActiveSubscription([])).toBeNull();
  });
});
