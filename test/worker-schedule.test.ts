import { describe, expect, it } from "vitest";
import { idleDelayMs, MAX_IDLE_MS, MIN_IDLE_MS } from "../app/lib/worker-schedule";

const now = new Date("2026-11-17T10:00:00Z");
const inMs = (ms: number) => new Date(now.getTime() + ms);

describe("idleDelayMs", () => {
  it("sleeps the full safety-net interval when nothing is scheduled", () => {
    expect(idleDelayMs(null, now)).toBe(MAX_IDLE_MS);
  });

  it("wakes when the next job is due", () => {
    expect(idleDelayMs(inMs(4 * 60_000), now)).toBe(4 * 60_000);
  });

  it("never sleeps longer than the safety net", () => {
    expect(idleDelayMs(inMs(5 * 60 * 60_000), now)).toBe(MAX_IDLE_MS);
  });

  it("never spins on something already due", () => {
    expect(idleDelayMs(inMs(-60_000), now)).toBe(MIN_IDLE_MS);
    expect(idleDelayMs(inMs(1_000), now)).toBe(MIN_IDLE_MS);
  });

  it("leaves the database idle long enough for Neon to suspend it", () => {
    expect(MAX_IDLE_MS).toBeGreaterThan(5 * 60_000);
  });
});
