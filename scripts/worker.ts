// Long-running queue worker: the `worker` container on AWS production
// (Dockerfile / deploy-prod.yml) and `npm run worker` locally. On Vercel
// (staging) the same drainQueue/runMaintenance run from webhooks and
// /api/cron/drain instead — don't run this there.
//
// It does not poll: new work is drained by the web container as it arrives,
// so the worker only handles retries, pending-date fills and leftovers. When
// the queue is empty it sleeps until the next one is due (at most
// MAX_IDLE_MS) and closes its database connections meanwhile, so Neon can
// suspend the compute. See app/lib/worker-schedule.ts.
import prisma from "../app/db.server";
import { nextDueAt } from "../app/lib/jobs.server";
import { log } from "../app/lib/logger.server";
import { drainQueue, runMaintenance } from "../app/lib/queue-runner.server";
import { captureError, errorMessage, flushSentry, initSentry } from "../app/lib/sentry.server";
import { idleDelayMs, MAX_IDLE_MS, PRUNE_EVERY_MS } from "../app/lib/worker-schedule";

initSentry("worker");

let stopping = false;
let wake: (() => void) | null = null;
function stop() {
  stopping = true;
  wake?.(); // don't make a deploy wait out a long idle sleep
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      wake = null;
      resolve();
    }
    wake = done;
  });
}

async function main() {
  let lastPrune = 0;
  log.info("worker started");
  while (!stopping) {
    try {
      const prune = Date.now() - lastPrune > PRUNE_EVERY_MS;
      const m = await runMaintenance({ prune });
      if (prune) {
        lastPrune = Date.now();
        log.info(m, "worker maintenance");
      } else if (m.fills) log.info(m, "worker fills queued");
    } catch (err) {
      // A DB blip shouldn't kill the worker; report it and retry next round.
      log.error({ err: errorMessage(err) }, "worker maintenance failed");
      captureError(err, { where: "maintenance" });
    }

    let delay = MAX_IDLE_MS;
    try {
      const r = await drainQueue({ budgetMs: 30_000 });
      if (r.processed || r.failed) {
        log.info(r, "worker drained");
        continue; // there may be more; check again straight away
      }
      delay = idleDelayMs(await nextDueAt());
    } catch (err) {
      log.error({ err: errorMessage(err) }, "worker drain failed");
      captureError(err, { where: "drain" });
      delay = 60_000;
    }

    // Release the connections so the idle database isn't held open.
    await prisma.$disconnect().catch(() => undefined);
    log.debug({ sleepMs: delay }, "worker idle");
    if (!stopping) await sleep(delay);
  }
  log.info("worker stopped");
  await prisma.$disconnect().catch(() => undefined);
  await flushSentry();
}

main().catch(async (err) => {
  log.fatal({ err: errorMessage(err) }, "worker crashed");
  captureError(err, { where: "worker" });
  await flushSentry();
  process.exit(1);
});
