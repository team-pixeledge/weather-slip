// Pure rules for what a failed queue job does next: retry, give up, and
// which operator alert (if any) to send. Kept free of Prisma/Shopify so it
// can be unit-tested.
import type { WeatherJob } from "@prisma/client";

export const MAX_ATTEMPTS = 5;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * The shop's offline token can't be used until the merchant opens the app
 * again (which stores a fresh session). Retrying can't fix that, so a job
 * failing with this gives up at once.
 */
export class ShopReauthRequiredError extends Error {
  constructor(shop: string, why: string) {
    super(`${shop}: ${why} — the merchant must open the app again to re-authorise it`);
    this.name = "ShopReauthRequiredError";
  }
}

/** Why a shop's stored offline session can't be used, or null if it can. */
export function offlineSessionProblem(
  session: { refreshToken: string | null; refreshTokenExpires: Date | null } | null,
  now = new Date(),
): string | null {
  if (!session) return "no offline session is stored";
  if (session.refreshToken && session.refreshTokenExpires && session.refreshTokenExpires <= now) {
    return `the offline refresh token expired on ${session.refreshTokenExpires.toISOString()}`;
  }
  return null;
}

/**
 * Shopify's app library throws a bare Response(500) when refreshing an
 * expiring offline token fails. In a queue job the only Response-throwing
 * call is `unauthenticated.admin`, so that's what this detects.
 */
export function isTokenRefreshFailure(error: unknown): boolean {
  return error instanceof Response && error.status === 500;
}

export interface FailurePlan {
  status: "PENDING" | "FAILED";
  runAfter: Date;
  alert: { key: string; subject: string; text: string; throttleMs: number } | null;
}

/** Exponential backoff (2, 4, 8, 16 min), then give up; reauth errors give up at once. */
export function failurePlan(
  job: Pick<WeatherJob, "id" | "shop" | "orderId" | "reason" | "attempts">,
  error: unknown,
  message: string,
  now = new Date(),
): FailurePlan {
  const runAfter = new Date(now.getTime() + 2 ** job.attempts * 60_000);
  const reauth = error instanceof ShopReauthRequiredError;
  if (!reauth && job.attempts < MAX_ATTEMPTS) return { status: "PENDING", runAfter, alert: null };

  if (reauth || isTokenRefreshFailure(error)) {
    // One email per shop per day, whatever the number of its orders queued:
    // a closed or frozen store fails every job the same way.
    return {
      status: "FAILED",
      runAfter,
      alert: {
        key: `shop-token:${job.shop}`,
        subject: `Can't reach ${job.shop} — its access token can't be refreshed`,
        text:
          `Weather couldn't be saved for order ${job.orderId} (job ${job.id}, ${job.reason}) on ${job.shop}` +
          (reauth ? "." : ` after ${job.attempts} attempts.`) +
          `\n\nLast error: ${message}\n\n` +
          "Usually the store was closed or frozen, or its refresh token expired or was revoked. " +
          "It starts working again when the merchant opens the app; until then every job for this shop fails the same way " +
          "(further failures are counted in the next email, at most one a day).",
        throttleMs: DAY,
      },
    };
  }

  return {
    status: "FAILED",
    runAfter,
    alert: {
      key: "job-failed",
      subject: "An order's weather couldn't be saved",
      text: `Job ${job.id} (${job.reason}) for order ${job.orderId} on ${job.shop} failed ${job.attempts} times and gave up.\n\nLast error: ${message}`,
      throttleMs: HOUR,
    },
  };
}
