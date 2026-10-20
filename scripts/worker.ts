// Long-running queue worker: the `worker` container on AWS production
// (Dockerfile / deploy-prod.yml) and `npm run worker` locally. On Vercel
// (staging) the same drainQueue/runMaintenance run from webhooks and
// /api/cron/drain instead — don't run this there.
import { log } from "../app/lib/logger.server";
import { drainQueue, runMaintenance } from "../app/lib/queue-runner.server";
import { captureError, flushSentry, initSentry } from "../app/lib/sentry.server";

initSentry("worker");

const IDLE_MS = 5_000;
const MAINTENANCE_MS = 10 * 60_000;

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

async function main() {
  let lastMaintenance = 0;
  log.info("worker started");
  while (!stopping) {
    if (Date.now() - lastMaintenance > MAINTENANCE_MS) {
      try {
        log.info(await runMaintenance(), "worker maintenance");
      } catch (err) {
        // A DB blip shouldn't kill the worker; report it and retry next round.
        log.error({ err: err instanceof Error ? err.message : String(err) }, "worker maintenance failed");
        captureError(err, { where: "maintenance" });
      }
      lastMaintenance = Date.now();
    }
    const r = await drainQueue({ budgetMs: 30_000 });
    if (r.processed || r.failed) log.info(r, "worker drained");
    else await new Promise((res) => setTimeout(res, IDLE_MS));
  }
  log.info("worker stopped");
  await flushSentry();
}

main().catch(async (err) => {
  log.fatal({ err: err instanceof Error ? err.message : String(err) }, "worker crashed");
  captureError(err, { where: "worker" });
  await flushSentry();
  process.exit(1);
});
