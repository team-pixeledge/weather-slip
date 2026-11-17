// When the idle worker should look at the queue again (scripts/worker.ts).
//
// Neon only bills compute while the database is awake, and it goes to sleep
// after ~5 minutes without queries. Polling every few seconds kept it awake
// around the clock and used up the free plan's monthly allowance by mid-month
// (Nov 2026). So the worker sleeps until the next thing it knows is due — a
// retry, a pending-date fill, a stale lock to release — and otherwise checks
// only every MAX_IDLE_MS as a safety net. New work doesn't need the worker:
// webhooks and print routes drain the queue themselves in the web container.

/** Longest idle sleep. Bounds how late a retry scheduled by the web container is picked up. */
export const MAX_IDLE_MS = 30 * 60_000;
/** Shortest idle sleep, so a job that is due but momentarily locked can't make the loop spin. */
export const MIN_IDLE_MS = 30_000;
/** Housekeeping that isn't time-critical (pruning old jobs and cache rows). */
export const PRUNE_EVERY_MS = 6 * 60 * 60_000;

/** Milliseconds to sleep, given the earliest moment anything in the queue becomes due (null = nothing). */
export function idleDelayMs(nextDueAt: Date | null, now = new Date()): number {
  if (!nextDueAt) return MAX_IDLE_MS;
  const wait = nextDueAt.getTime() - now.getTime();
  return Math.min(MAX_IDLE_MS, Math.max(MIN_IDLE_MS, wait));
}
