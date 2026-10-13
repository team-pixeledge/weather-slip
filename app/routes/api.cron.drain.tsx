import { timingSafeEqual } from "node:crypto";
import type { LoaderFunctionArgs } from "react-router";
import { drainQueue, runMaintenance } from "../lib/queue-runner.server";
import { beat, checkHeartbeat } from "../lib/alerts.server";

// Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET` (it adds
// the header itself when CRON_SECRET is set in the project). Any other
// scheduler — a future EventBridge rule, or curl — must send the same.
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  // The 10-minute GitHub Actions run records a heartbeat; Vercel's daily
  // cron (user agent "vercel-cron/…") checks it, so a stopped scheduler
  // (e.g. GitHub disabling the workflow after 60 days without commits)
  // gets noticed.
  if (/vercel-cron/i.test(request.headers.get("user-agent") ?? "")) {
    await checkHeartbeat("drain-10min", 2 * 60 * 60 * 1000, "The 10-minute queue runner (GitHub Actions)");
  } else {
    await beat("drain-10min");
  }
  const maintenance = await runMaintenance();
  const drained = await drainQueue();
  return Response.json({ ...maintenance, ...drained });
};
