import { waitUntil } from "@vercel/functions";
import { captureError } from "./sentry.server";

/**
 * Run work after the response has been sent. On Vercel (staging) this keeps
 * the function alive until `task` settles (up to the function's max
 * duration); on the long-running Node server (AWS production, local dev) the
 * promise simply keeps running, and the worker container picks up anything
 * it doesn't finish.
 */
export function runInBackground(task: Promise<unknown>): void {
  const guarded = task.catch((err) => {
    console.error("[background]", err instanceof Error ? err.message : err);
    captureError(err, { where: "background" });
  });
  if (process.env.VERCEL) waitUntil(guarded);
}
