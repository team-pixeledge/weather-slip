import { describe, expect, it } from "vitest";
import { addWorkingDays, localDate, shippingDates, shortDay } from "../app/lib/dates";

describe("addWorkingDays", () => {
  it("skips weekends", () => {
    // 2026-10-16 is a Friday.
    expect(addWorkingDays("2026-10-16", 1, true)).toBe("2026-10-19");
    expect(addWorkingDays("2026-10-16", 3, true)).toBe("2026-10-21");
  });
  it("moves a weekend start to Monday even for 0 days", () => {
    expect(addWorkingDays("2026-10-17", 0, true)).toBe("2026-10-19");
  });
  it("counts calendar days when not skipping", () => {
    expect(addWorkingDays("2026-10-16", 3, false)).toBe("2026-10-19");
  });
  it("crosses month and year boundaries", () => {
    expect(addWorkingDays("2026-12-31", 1, false)).toBe("2027-01-01");
  });
});

describe("localDate", () => {
  it("uses the shop's timezone, not UTC", () => {
    // 20:00 UTC is already the next day in India.
    const t = new Date("2026-10-12T20:00:00Z");
    expect(localDate(t, "UTC")).toBe("2026-10-12");
    expect(localDate(t, "Asia/Kolkata")).toBe("2026-10-13");
    expect(localDate(t, "America/Los_Angeles")).toBe("2026-10-12");
  });
});

describe("shippingDates", () => {
  const settings = { handlingDays: 1, transitDays: 3, skipWeekends: true };
  it("estimates from the order date", () => {
    expect(shippingDates({ orderDate: "2026-10-12" }, settings)).toEqual({
      dispatch: "2026-10-13",
      delivery: "2026-10-16",
    });
  });
  it("prefers the real fulfillment date and carrier estimate", () => {
    expect(
      shippingDates(
        { orderDate: "2026-10-12", fulfilledDate: "2026-10-14", estimatedDeliveryDate: "2026-10-20" },
        settings,
      ),
    ).toEqual({ dispatch: "2026-10-14", delivery: "2026-10-20" });
  });
  it("rolls a missed dispatch day forward to today until the order ships", () => {
    const quick = { handlingDays: 1, transitDays: 1, skipWeekends: false };
    // Ordered 12-10, due out 13-10, still unshipped on 15-10.
    expect(shippingDates({ orderDate: "2026-10-12", today: "2026-10-15" }, quick)).toEqual({
      dispatch: "2026-10-15",
      delivery: "2026-10-16",
    });
    // Not missed yet: unchanged.
    expect(shippingDates({ orderDate: "2026-10-12", today: "2026-10-13" }, quick).dispatch).toBe("2026-10-13");
    // Shipped late: the real date wins.
    expect(
      shippingDates({ orderDate: "2026-10-12", today: "2026-10-20", fulfilledDate: "2026-10-15" }, quick).dispatch,
    ).toBe("2026-10-15");
    // Missed on a Saturday with weekends skipped: next weekday.
    expect(shippingDates({ orderDate: "2026-10-12", today: "2026-10-17" }, settings).dispatch).toBe("2026-10-19");
  });
});

it("shortDay", () => {
  expect(shortDay("2026-10-15")).toBe("Thu 15 Oct");
});
