import { describe, expect, it } from "vitest";
import { aggregateDaily, offsetLabel } from "../app/lib/weather/openweather.server";

// Build 3-hour slots for a location at UTC+5:30 (19800 s).
const OFFSET = 19800;
function slot(localIso: string, min: number, max: number, pop: number, id = 500, description = "light rain") {
  const dt = Date.parse(`${localIso}Z`) / 1000 - OFFSET;
  return { dt, main: { temp_min: min, temp_max: max }, weather: [{ id, description }], pop };
}

describe("aggregateDaily", () => {
  it("groups by destination-local date and takes min/max/max pop", () => {
    const list = [
      slot("2026-10-12T21:00:00", 24, 25, 0.1),
      ...["00", "03", "06", "09", "12", "15", "18", "21"].map((h, i) =>
        slot(`2026-10-13T${h}:00:00`, 20 + i, 22 + i, i === 3 ? 0.65 : 0.2, h === "12" ? 800 : 500, h === "12" ? "clear sky" : "light rain"),
      ),
      slot("2026-10-14T00:00:00", 18, 19, 0), // partial last day: dropped
    ];
    const days = aggregateDaily({ city: { timezone: OFFSET }, list }, "2026-10-12");
    expect(days.map((d) => d.date)).toEqual(["2026-10-12", "2026-10-13"]);
    expect(days[1]).toEqual({
      date: "2026-10-13",
      minC: 20,
      maxC: 29,
      precipProb: 65,
      code: 800,
      label: "Clear sky", // the slot nearest local midday
    });
  });
});

it("offsetLabel keeps half/quarter-hour offsets", () => {
  expect(offsetLabel(0)).toBe("UTC+00:00");
  expect(offsetLabel(19800)).toBe("UTC+05:30");
  expect(offsetLabel(20700)).toBe("UTC+05:45");
  expect(offsetLabel(-12600)).toBe("UTC-03:30");
});
