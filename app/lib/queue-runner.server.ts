// Platform-neutral queue driver. Today it's called from a webhook's
// background task and the Vercel Cron route (/api/cron/drain); on AWS it
// would be called from a scheduled Lambda or a long-running worker
// (scripts/worker.ts) — the queue itself doesn't care which.
import { claimJobs, completeJob, enqueueDueFills, failJob, pruneFinishedJobs } from "./jobs.server";
import { processJob } from "./order-weather.server";
import { pruneExpiredCache } from "./weather/cache.server";

export interface DrainResult {
  processed: number;
  failed: number;
}

/**
 * Process due jobs until the queue is empty or `budgetMs` runs out —
 * serverless functions have a hard time limit, so stop claiming new work
 * well before it.
 */
export async function drainQueue({
  budgetMs = 45_000,
  batchSize = 10,
}: { budgetMs?: number; batchSize?: number } = {}): Promise<DrainResult> {
  const deadline = Date.now() + budgetMs;
  const result: DrainResult = { processed: 0, failed: 0 };
  while (Date.now() < deadline) {
    const jobs = await claimJobs(batchSize);
    if (jobs.length === 0) break;
    for (const job of jobs) {
      try {
        await processJob(job);
        await completeJob(job.id);
        result.processed++;
      } catch (err) {
        await failJob(job, err);
        result.failed++;
        console.error(`[queue] job ${job.id} (${job.reason}) failed:`, err instanceof Error ? err.message : err);
      }
    }
  }
  return result;
}

/** Periodic housekeeping: schedule pending-date fills, prune old rows. */
export async function runMaintenance() {
  const fills = await enqueueDueFills();
  const jobsPruned = await pruneFinishedJobs();
  const cachePruned = await pruneExpiredCache();
  return { fills, jobsPruned, cachePruned };
}
