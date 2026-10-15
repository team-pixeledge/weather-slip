import type { Prisma, Shop } from "@prisma/client";
import prisma from "../db.server";
import type { DisplaySettings } from "./format";
import { PLANS, USAGE_PERIOD_DAYS } from "./plans";
import { sanitizeDesign, type SlipOptions } from "./slip";
import { OpenMeteoProvider } from "./weather/open-meteo.server";
import { OpenWeatherProvider } from "./weather/openweather.server";
import type { WeatherProvider } from "./weather/types";
import { runInBackground } from "./background.server";
import { notifyAdminLater, OPENWEATHER_FREE_MONTHLY, recordApiCall } from "./alerts.server";

/** Count every OpenWeather call and alert the operator on failures. */
function watchOpenWeather(path: string, status: number | "timeout") {
  void recordApiCall("openweather", OPENWEATHER_FREE_MONTHLY);
  if (status === 401) {
    notifyAdminLater(
      "openweather:401",
      "OpenWeather rejected an API key",
      `A call to ${path} returned 401. A key in OPENWEATHER_API_KEYS (or a Business merchant's own key) is invalid, revoked or not yet active. The next key in the list is tried; if none work, weather lookups fail.`,
    );
  } else if (status === 429) {
    notifyAdminLater(
      "openweather:429",
      "OpenWeather rate limit hit",
      `A call to ${path} returned 429 (too many requests — the free plan allows 60/minute and 1,000,000/month). Weather lookups are failing until the limit clears; jobs retry with backoff.`,
    );
  } else if (status === "timeout" || status >= 500) {
    notifyAdminLater(
      "openweather:down",
      "OpenWeather is failing",
      `A call to ${path} ${status === "timeout" ? "timed out" : `returned ${status}`}. If this continues, slips print without weather until OpenWeather recovers.`,
    );
  }
}

type Db = typeof prisma | Prisma.TransactionClient;

/** Create the shop row on first sight, or reactivate it on reinstall. */
export async function ensureShop(shop: string, timezone?: string | null): Promise<Shop> {
  return prisma.shop.upsert({
    where: { shop },
    create: { shop, ...(timezone ? { timezone } : {}) },
    update: { uninstalledAt: null, ...(timezone ? { timezone } : {}) },
  });
}

/** The shop's saved packing-slip settings. */
export function slipOptions(shop: Shop): SlipOptions {
  return {
    template: shop.slipTemplate,
    paper: shop.slipPaper,
    showImages: shop.slipShowImages,
    showSku: shop.slipShowSku,
    showBilling: shop.slipShowBilling,
    showNote: shop.slipShowNote,
    footer: shop.slipFooter,
    design: sanitizeDesign(shop.slipDesign),
  };
}

export function displaySettings(shop: Shop): DisplaySettings {
  return {
    unit: shop.unit,
    showCurrent: shop.showCurrent,
    showDispatch: shop.showDispatch,
    showDelivery: shop.showDelivery,
    showPrecip: shop.showPrecip,
    showLocation: shop.showLocation,
  };
}

function envKeys(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * WEATHER_PROVIDER picks the engine (default OpenWeather). Always the app's
 * own keys — merchants can't bring their own.
 */
export function providerFor(): WeatherProvider {
  if (process.env.WEATHER_PROVIDER === "open-meteo") {
    return new OpenMeteoProvider(process.env.OPEN_METEO_API_KEY || null);
  }
  return new OpenWeatherProvider(envKeys("OPENWEATHER_API_KEYS"), watchOpenWeather);
}

/**
 * Take one unit of the shop's monthly print allowance. Atomic: two
 * concurrent orders can't both squeeze past the limit. Returns false when
 * the shop is at its limit.
 */
export async function consumeUsage(
  shop: Shop,
  now = new Date(),
  db: Db = prisma,
): Promise<boolean> {
  const periodMs = USAGE_PERIOD_DAYS * 86_400_000;
  if (now.getTime() - shop.usagePeriodStart.getTime() >= periodMs) {
    await db.shop.updateMany({
      where: { shop: shop.shop, usagePeriodStart: shop.usagePeriodStart },
      data: { usagePeriodStart: now, usageCount: 0, usageAlertLevel: 0 },
    });
  }
  const limit = PLANS[shop.plan].ordersPerPeriod;
  const { count } = await db.shop.updateMany({
    where: { shop: shop.shop, usageCount: { lt: limit } },
    data: { usageCount: { increment: 1 } },
  });
  return count === 1;
}

class LimitReached extends Error {}

/** Printing the same order again within this window doesn't charge again. */
export const PRINT_RECHARGE_MS = 10 * 60 * 1000;

/**
 * Plans count prints (user decision 2026-10-14): every order on every print
 * with weather uses one unit — reprints included. Printing the same order
 * again within PRINT_RECHARGE_MS is free, so the admin print preview
 * reloading, a refreshed tab or a double-click don't each charge.
 *
 * True if the print may show weather (charged now, or charged moments
 * ago), false at the plan limit. Atomic: the conditional upsert on
 * CountedOrder decides "charge or not" in one statement, and a refused
 * usage take rolls it back.
 */
export async function chargePrint(shop: Shop, orderId: string, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - PRINT_RECHARGE_MS);
  try {
    const charged = await prisma.$transaction(async (tx) => {
      const due = await tx.$executeRaw`
        INSERT INTO "CountedOrder" ("shop", "orderId", "countedAt", "lastPrintedAt")
        VALUES (${shop.shop}, ${orderId}, ${now}, ${now})
        ON CONFLICT ("shop", "orderId") DO UPDATE SET "lastPrintedAt" = EXCLUDED."lastPrintedAt"
        WHERE "CountedOrder"."lastPrintedAt" IS NULL OR "CountedOrder"."lastPrintedAt" < ${since}`;
      if (due === 0) return false; // printed moments ago: free
      if (await consumeUsage(shop, now, tx)) return true;
      throw new LimitReached();
    });
    if (charged) {
      // Lazy import: usage-alerts reaches shopify.server, which imports this file.
      runInBackground(import("./usage-alerts.server").then((m) => m.notifyUsageIfNeeded(shop.shop)));
    }
    return true;
  } catch (err) {
    if (err instanceof LimitReached) return false;
    throw err;
  }
}

/**
 * Mark an order as having weather without charging (Shopify Flow saves
 * weather ahead of printing; the print itself is what's charged).
 */
export async function markCounted(shop: string, orderId: string, now = new Date()): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "CountedOrder" ("shop", "orderId", "countedAt")
    VALUES (${shop}, ${orderId}, ${now})
    ON CONFLICT DO NOTHING`;
}

/** Get-started steps done outside the app (Plans page checklist). */
export const CHECKLIST_STEPS = ["printFromShopify", "flow", "snippet"] as const;
export type ChecklistStep = (typeof CHECKLIST_STEPS)[number];
export const isChecklistStep = (v: unknown): v is ChecklistStep =>
  (CHECKLIST_STEPS as readonly unknown[]).includes(v);

/**
 * Tick (or untick) a checklist step. Called automatically when the app
 * sees the step happen (a print from Shopify's Orders page, a Flow run)
 * and from the Plans page's "Mark as done". Never throws — it's display
 * state and mustn't break a print or a Flow run.
 */
export async function setChecklistStep(shop: string, step: ChecklistStep, done = true): Promise<void> {
  try {
    if (done) {
      await prisma.$executeRaw`
        UPDATE "Shop" SET "checklistDone" = array_append("checklistDone", ${step})
         WHERE shop = ${shop} AND NOT (${step} = ANY("checklistDone"))`;
    } else {
      await prisma.$executeRaw`
        UPDATE "Shop" SET "checklistDone" = array_remove("checklistDone", ${step}) WHERE shop = ${shop}`;
    }
  } catch (err) {
    console.warn("[checklist]", step, err instanceof Error ? err.message : err);
  }
}

/** How far back the Orders page looks for Flow-saved orders not yet printed. */
export const READY_TO_PRINT_DAYS = 14;

/**
 * "Ready to print": orders whose weather Shopify Flow saved (markCounted)
 * that were never printed, newest first. Browsers can't print on their
 * own, so a Flow run can only line the slip up; the Orders page offers
 * these as one click (user decision 2026-10-15). The caller still checks
 * with Shopify that they're unfulfilled.
 */
export async function readyToPrintIds(shop: string, now = new Date(), limit = 250): Promise<string[]> {
  const since = new Date(now.getTime() - READY_TO_PRINT_DAYS * 86_400_000);
  const rows = await prisma.$queryRaw<{ orderId: string }[]>`
    SELECT c."orderId" FROM "CountedOrder" c
     WHERE c.shop = ${shop} AND c."countedAt" >= ${since}
       AND NOT EXISTS (SELECT 1 FROM "PrintedOrder" p WHERE p.shop = c.shop AND p."orderId" = c."orderId")
     ORDER BY c."countedAt" DESC
     LIMIT ${limit}`;
  return rows.map((r) => r.orderId);
}

/** Print dates kept per order for the Orders page tooltip. */
export const PRINT_HISTORY_MAX = 50;

/**
 * Remember that these orders' slips were printed (Orders page: dimmed row,
 * "Reprint"). A repeat within PRINT_RECHARGE_MS doesn't add to printCount.
 * Never throws — it's display state, it mustn't break a print.
 */
export async function recordPrints(shop: string, orderIds: string[], now = new Date()): Promise<void> {
  if (!orderIds.length) return;
  const since = new Date(now.getTime() - PRINT_RECHARGE_MS);
  try {
    await prisma.$executeRaw`
      INSERT INTO "PrintedOrder" ("shop", "orderId", "firstPrintedAt", "lastPrintedAt", "printCount", "printedAt")
      SELECT ${shop}, id, ${now}, ${now}, 1, ARRAY[${now}::timestamp(3)] FROM unnest(${orderIds}::text[]) AS id
      ON CONFLICT ("shop", "orderId") DO UPDATE SET
        "printCount" = "PrintedOrder"."printCount" + CASE WHEN "PrintedOrder"."lastPrintedAt" < ${since} THEN 1 ELSE 0 END,
        -- History of counted prints, newest last, capped (PRINT_HISTORY_MAX).
        "printedAt" = CASE WHEN "PrintedOrder"."lastPrintedAt" < ${since}
          THEN (array_append(COALESCE("PrintedOrder"."printedAt", '{}'), ${now}::timestamp(3)))[
                 GREATEST(1, COALESCE(cardinality("PrintedOrder"."printedAt"), 0) + 2 - ${PRINT_HISTORY_MAX}):]
          ELSE "PrintedOrder"."printedAt" END,
        "lastPrintedAt" = EXCLUDED."lastPrintedAt"`;
  } catch (err) {
    console.error("[printed] record failed:", err instanceof Error ? err.message : err);
  }
}

export async function isCounted(shop: string, orderId: string): Promise<boolean> {
  const row = await prisma.countedOrder.findUnique({
    where: { shop_orderId: { shop, orderId } },
    select: { shop: true },
  });
  return row != null;
}

/** This period's usage, as the merchant sees it (a lapsed period reads as 0). */
export function usageSummary(shop: Shop, now = Date.now()) {
  const periodMs = USAGE_PERIOD_DAYS * 86_400_000;
  const elapsed = now - shop.usagePeriodStart.getTime() >= periodMs;
  const used = elapsed ? 0 : shop.usageCount;
  const limit = PLANS[shop.plan].ordersPerPeriod;
  return {
    used,
    limit,
    pct: Math.min(100, Math.floor((used / limit) * 100)),
    resetsAt: new Date(elapsed ? now + periodMs : shop.usagePeriodStart.getTime() + periodMs).toISOString(),
  };
}
