import { describe, expect, it } from "vitest";
import {
  failurePlan,
  isTokenRefreshFailure,
  MAX_ATTEMPTS,
  offlineSessionProblem,
  ShopReauthRequiredError,
} from "../app/lib/job-failure";

const now = new Date("2026-11-09T10:00:00Z");
const job = (attempts: number) => ({
  id: "job1",
  shop: "a.myshopify.com",
  orderId: "123",
  reason: "PENDING_FILL" as const,
  attempts,
});
const refreshFailure = () => new Response(undefined, { status: 500, statusText: "Internal Server Error" });

describe("offlineSessionProblem", () => {
  it("flags a missing session", () => {
    expect(offlineSessionProblem(null, now)).toBe("no offline session is stored");
  });
  it("flags an expired refresh token", () => {
    expect(
      offlineSessionProblem({ refreshToken: "r", refreshTokenExpires: new Date("2026-11-01T00:00:00Z") }, now),
    ).toMatch(/expired on 2026-11-01/);
  });
  it("accepts a live refresh token or a non-expiring token", () => {
    expect(offlineSessionProblem({ refreshToken: "r", refreshTokenExpires: new Date("2027-01-01") }, now)).toBeNull();
    expect(offlineSessionProblem({ refreshToken: null, refreshTokenExpires: null }, now)).toBeNull();
  });
});

describe("failurePlan", () => {
  it("retries with backoff and no alert before the last attempt", () => {
    const plan = failurePlan(job(2), refreshFailure(), "x", now);
    expect(plan).toEqual({ status: "PENDING", runAfter: new Date(now.getTime() + 4 * 60_000), alert: null });
  });

  it("gives up at once on a reauth error, with one alert per shop per day", () => {
    const plan = failurePlan(job(1), new ShopReauthRequiredError("a.myshopify.com", "no offline session is stored"), "m", now);
    expect(plan.status).toBe("FAILED");
    expect(plan.alert?.key).toBe("shop-token:a.myshopify.com");
    expect(plan.alert?.throttleMs).toBe(24 * 60 * 60 * 1000);
  });

  it("sends a refresh failure that exhausts its retries to the per-shop alert", () => {
    const plan = failurePlan(job(MAX_ATTEMPTS), refreshFailure(), "m", now);
    expect(plan.status).toBe("FAILED");
    expect(plan.alert?.key).toBe("shop-token:a.myshopify.com");
    expect(plan.alert?.text).toMatch(/after 5 attempts/);
  });

  it("keeps the generic hourly alert for other errors", () => {
    const plan = failurePlan(job(MAX_ATTEMPTS), new Error("metafieldsSet failed"), "metafieldsSet failed", now);
    expect(plan.alert?.key).toBe("job-failed");
    expect(plan.alert?.throttleMs).toBe(60 * 60 * 1000);
  });
});

describe("isTokenRefreshFailure", () => {
  it("is a thrown Response(500) only", () => {
    expect(isTokenRefreshFailure(refreshFailure())).toBe(true);
    expect(isTokenRefreshFailure(new Response("{}", { status: 429 }))).toBe(false);
    expect(isTokenRefreshFailure(new Error("x"))).toBe(false);
  });
});
