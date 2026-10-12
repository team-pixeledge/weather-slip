// Long-running queue worker for environments that have one: local dev
// (`npm run worker`) and, later, an AWS container/ECS task. On Vercel the
// same drainQueue/runMaintenance run from webhooks and /api/cron/drain
// instead — don't run this there.
import { drainQueue, runMaintenance } from "../app/lib/queue-runner.server";

const IDLE_MS = 5_000;
const MAINTENANCE_MS = 10 * 60_000;

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

async function main() {
  let lastMaintenance = 0;
  console.log("[worker] started");
  while (!stopping) {
    if (Date.now() - lastMaintenance > MAINTENANCE_MS) {
      console.log("[worker] maintenance", await runMaintenance());
      lastMaintenance = Date.now();
    }
    const r = await drainQueue({ budgetMs: 30_000 });
    if (r.processed || r.failed) console.log("[worker]", r);
    else await new Promise((res) => setTimeout(res, IDLE_MS));
  }
  console.log("[worker] stopped");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
