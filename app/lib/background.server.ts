import { waitUntil } from "@vercel/functions";

/**
 * Run work after the response has been sent. On Vercel this keeps the
 * function alive until `task` settles (up to the function's max duration);
 * on a long-running Node server (local dev, a future AWS container) the
 * promise simply keeps running. This is the one place to change when the
 * app moves off Vercel.
 */
export function runInBackground(task: Promise<unknown>): void {
  const guarded = task.catch((err) => {
    console.error("[background]", err instanceof Error ? err.message : err);
  });
  waitUntil(guarded);
}
