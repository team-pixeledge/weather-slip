import { describe, expect, it } from "vitest";
import { formatSummary, type DisplaySettings } from "../app/lib/format";
import { cacheKey, locationKey } from "../app/lib/location";
import { buildSnapshot, destinationToday, fillPendingDays, hasPendingDays, nextFillDate } from "../app/lib/snapshot";
import type { ForecastPayload } from "../app/lib/weather/types";

const settings: DisplaySettings = {
  unit: "C",
  showCurrent: true,
  showDispatch: true,
  showDelivery: true,
  showPrecip: true,
  showLocation: true,
};

const forecast = (dates: string[]): ForecastPayload => ({
  provider: "test",
  timezone: "UTC",
  current: { tempC: 21.6, code: 800, label: "Clear sky", observedAt: "2026-10-12T09:00" },
  daily: dates.map((date, i) => ({
    date,
    minC: 10 + i,
    maxC: 20 + i,
    precipProb: i === 1 ? 70 : 5,
    code: 500,
    label: "Light rain",
  })),
});

const input = {
  horizonDays: 4,
  point: { lat: 18.5204, lon: 73.8567 },
  city: "Pune",
  countryCode: "IN",
  today: "2026-10-12",
  settings,
  dispatchAllowed: true,
  now: new Date("2026-10-12T09:00:00Z"),
};

describe("buildSnapshot", () => {
  it("fills days inside the horizon and formats one line", () => {
    const snap = buildSnapshot({
      ...input,
      forecast: forecast(["2026-10-12", "2026-10-13", "2026-10-14"]),
      dispatch: "2026-10-13",
      delivery: "2026-10-14",
    });
    expect(snap.dispatch).toMatchObject({ status: "ok", minC: 11, maxC: 21, minF: 52, maxF: 70 });
    expect(snap.location).toEqual({ city: "Pune", countryCode: "IN", lat: 18.5, lon: 73.9 });
    expect(snap.summary).toBe(
      "Pune, IN · Now 22°C, Clear sky · Dispatch Tue 13 Oct: 11–21°C, Light rain, 70% rain · Delivery Wed 14 Oct: 12–22°C, Light rain",
    );
    expect(hasPendingDays(snap)).toBe(false);
  });

  it("marks far dates pending and schedules the fill", () => {
    const snap = buildSnapshot({
      ...input,
      forecast: forecast(["2026-10-12", "2026-10-13"]),
      dispatch: "2026-10-13",
      delivery: "2026-10-22",
    });
    expect(snap.delivery.status).toBe("beyond_horizon");
    expect(snap.summary).toContain("Delivery Thu 22 Oct: forecast pending");
    expect(nextFillDate(snap, 4)).toBe("2026-10-19");
  });

  it("hides the dispatch day on plans without it", () => {
    const snap = buildSnapshot({
      ...input,
      dispatchAllowed: false,
      forecast: forecast(["2026-10-12", "2026-10-13", "2026-10-14"]),
      dispatch: "2026-10-13",
      delivery: "2026-10-14",
    });
    expect(snap.dispatch.status).toBe("hidden");
    expect(snap.summary).not.toContain("Dispatch");
  });
});

describe("fillPendingDays", () => {
  it("fills only the pending day and keeps printed values", () => {
    const first = buildSnapshot({
      ...input,
      forecast: forecast(["2026-10-12", "2026-10-13"]),
      dispatch: "2026-10-13",
      delivery: "2026-10-22",
    });
    const later: ForecastPayload = {
      ...forecast(["2026-10-21", "2026-10-22"]),
      current: { tempC: 5, code: 600, label: "Snow", observedAt: "x" },
    };
    const filled = fillPendingDays(first, later, "2026-10-19", 4, settings);
    expect(filled.dispatch).toEqual(first.dispatch);
    expect(filled.current).toEqual(first.current);
    expect(filled.delivery).toMatchObject({ status: "ok", minC: 11 });
    expect(hasPendingDays(filled)).toBe(false);
  });
});

describe("formatSummary units", () => {
  const snap = buildSnapshot({
    ...input,
    forecast: forecast(["2026-10-12", "2026-10-13"]),
    dispatch: "2026-10-12",
    delivery: "2026-10-13",
  });
  it("Fahrenheit", () => {
    expect(formatSummary(snap, { ...settings, unit: "F", showLocation: false, showCurrent: false, showDispatch: false }))
      .toBe("Delivery Tue 13 Oct: 52–70°F, Light rain, 70% rain");
  });
  it("both", () => {
    expect(formatSummary(snap, { ...settings, unit: "BOTH", showLocation: false, showDispatch: false, showDelivery: false }))
      .toBe("Now 22°C / 71°F, Clear sky");
  });
});

describe("location keys", () => {
  it("rounds to the 0.1° grid", () => {
    expect(cacheKey("openweather", { lat: 18.5204, lon: 73.8567 })).toBe("openweather:18.5:73.9");
  });
  it("ignores street-level moves inside a grid cell but sees a city change", () => {
    const a = locationKey({ latitude: 18.52, longitude: 73.85 });
    const b = locationKey({ latitude: 18.53, longitude: 73.86 });
    const c = locationKey({ latitude: 19.07, longitude: 72.87 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it("falls back to city/zip/country without coordinates", () => {
    expect(locationKey({ city: " Pune ", zip: "411 001", countryCode: "in" })).toBe(
      locationKey({ city: "pune", zip: "411001", countryCode: "IN" }),
    );
    expect(locationKey({})).toBeNull();
  });
});

describe("destinationToday", () => {
  it("uses the exact offset (India at 23:50 local is still the same day)", () => {
    const now = new Date("2026-10-12T18:20:00Z"); // 23:50 IST
    expect(destinationToday({ ...forecast([]), utcOffsetSec: 19800 }, now)).toBe("2026-10-12");
    expect(destinationToday({ ...forecast([]), utcOffsetSec: 21600 }, now)).toBe("2026-10-13");
  });
  it("falls back to the IANA zone", () => {
    const now = new Date("2026-10-12T20:00:00Z");
    expect(destinationToday({ ...forecast([]), timezone: "Asia/Tokyo" }, now)).toBe("2026-10-13");
  });
});
