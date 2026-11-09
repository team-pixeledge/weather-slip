import type { JobReason, WeatherJob } from "@prisma/client";
import prisma from "../db.server";
import { notifyAdmin } from "./alerts.server";
import { failurePlan } from "./job-failure";
import { errorMessage } from "./sentry.server";

const STALE_LOCK_MS = 10 * 60 * 1000;

/**
 * Queue work for an order. Webhooks are delivered at-least-once, so a second
 * enqueue while one is still pending for the same order is a no-op.
 */
export async function enqueue(
  shop: string,
  orderId: string,
  reason: JobReason,
  runAfter = new Date(),
): Promise<void> {
  const existing = await prisma.weatherJob.findFirst({
    where: { shop, orderId, status: "PENDING", reason },
    select: { id: true },
  });
  if (existing) return;
  await prisma.weatherJob.create({ data: { shop, orderId, reason, runAfter } });
}

/** Claim up to `limit` due jobs. Safe to run from several workers at once. */
export async function claimJobs(limit: number, now = new Date()): Promise<WeatherJob[]> {
  // A worker that died mid-job leaves it RUNNING; put it back after a while.
  await prisma.weatherJob.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } },
    data: { status: "PENDING", lockedAt: null },
  });
  return prisma.$queryRaw<WeatherJob[]>`
    UPDATE "WeatherJob"
       SET status = 'RUNNING', "lockedAt" = ${now}, attempts = attempts + 1, "updatedAt" = ${now}
     WHERE id IN (
       SELECT id FROM "WeatherJob"
        WHERE status = 'PENDING' AND "runAfter" <= ${now}
        ORDER BY "runAfter"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING *`;
}

export async function completeJob(id: string): Promise<void> {
  await prisma.weatherJob.update({
    where: { id },
    data: { status: "DONE", lockedAt: null, lastError: null },
  });
}

/** Retry with backoff or give up — see failurePlan for the rules. */
export async function failJob(job: WeatherJob, error: unknown, now = new Date()): Promise<void> {
  const message = errorMessage(error);
  const plan = failurePlan(job, error, message, now);
  await prisma.weatherJob.update({
    where: { id: job.id },
    data: {
      status: plan.status,
      lockedAt: null,
      lastError: message.slice(0, 1000),
      runAfter: plan.runAfter,
    },
  });
  if (plan.alert) {
    await notifyAdmin(plan.alert.key, plan.alert.subject, plan.alert.text, { throttleMs: plan.alert.throttleMs });
  }
}

/** Queue a fill for every snapshot whose pending date has entered the forecast window. */
export async function enqueueDueFills(now = new Date()): Promise<number> {
  const due = await prisma.orderWeatherSnapshot.findMany({
    where: { status: "PENDING_DATES", nextFillAt: { lte: now } },
    select: { id: true, shop: true, orderId: true },
    take: 500,
  });
  for (const s of due) {
    await enqueue(s.shop, s.orderId, "PENDING_FILL", now);
    await prisma.orderWeatherSnapshot.update({
      where: { id: s.id },
      data: { nextFillAt: null },
    });
  }
  return due.length;
}

export async function pruneFinishedJobs(now = new Date()): Promise<number> {
  const { count } = await prisma.weatherJob.deleteMany({
    where: {
      status: { in: ["DONE", "FAILED"] },
      updatedAt: { lt: new Date(now.getTime() - 14 * 86_400_000) },
    },
  });
  return count;
}
