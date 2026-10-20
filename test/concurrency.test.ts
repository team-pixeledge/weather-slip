import { describe, expect, it } from "vitest";
import { mapLimit } from "../app/lib/concurrency";

describe("mapLimit", () => {
  it("runs every item, never more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await mapLimit([...Array(50).keys()], 4, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 2));
      seen.push(n);
      running--;
    });
    expect(peak).toBe(4);
    expect(seen.sort((a, b) => a - b)).toEqual([...Array(50).keys()]);
  });

  it("handles an empty list and a limit above the item count", async () => {
    await mapLimit([], 4, async () => {});
    const seen: number[] = [];
    await mapLimit([1, 2], 10, async (n) => void seen.push(n));
    expect(seen.sort()).toEqual([1, 2]);
  });

  it("rejects when a task throws", async () => {
    await expect(mapLimit([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error("boom"); })).rejects.toThrow("boom");
  });
});
