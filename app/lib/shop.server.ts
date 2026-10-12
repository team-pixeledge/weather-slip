import type { Shop } from "@prisma/client";
import prisma from "../db.server";
import { decrypt } from "./crypto.server";
import type { DisplaySettings } from "./format";
import { PLANS, USAGE_PERIOD_DAYS } from "./plans";
import { OpenMeteoProvider } from "./weather/open-meteo.server";
import { OpenWeatherProvider } from "./weather/openweather.server";
import type { WeatherProvider } from "./weather/types";

/** Create the shop row on first sight, or reactivate it on reinstall. */
export async function ensureShop(shop: string, timezone?: string | null): Promise<Shop> {
  return prisma.shop.upsert({
    where: { shop },
    create: { shop, ...(timezone ? { timezone } : {}) },
    update: { uninstalledAt: null, ...(timezone ? { timezone } : {}) },
  });
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
 * WEATHER_PROVIDER picks the engine (default OpenWeather). A Pro merchant's
 * own key is tried first, with the app's keys behind it as failover for a
 * rejected key.
 */
export function providerFor(shop: Shop): WeatherProvider {
  let own: string | null = null;
  if (PLANS[shop.plan].ownApiKey && shop.weatherApiKeyEnc) {
    try {
      own = decrypt(shop.weatherApiKeyEnc);
    } catch {
      // Unreadable (e.g. ENCRYPTION_KEY rotated) — fall back to ours rather
      // than failing every order.
    }
  }
  if (process.env.WEATHER_PROVIDER === "open-meteo") {
    return new OpenMeteoProvider(own ?? (process.env.OPEN_METEO_API_KEY || null));
  }
  return new OpenWeatherProvider([...(own ? [own] : []), ...envKeys("OPENWEATHER_API_KEYS")]);
}

/**
 * Take one unit of the shop's monthly order allowance. Atomic: two
 * concurrent orders can't both squeeze past the limit. Returns false when
 * the shop is at its limit.
 */
export async function consumeUsage(shop: Shop, now = new Date()): Promise<boolean> {
  const periodMs = USAGE_PERIOD_DAYS * 86_400_000;
  if (now.getTime() - shop.usagePeriodStart.getTime() >= periodMs) {
    await prisma.shop.updateMany({
      where: { shop: shop.shop, usagePeriodStart: shop.usagePeriodStart },
      data: { usagePeriodStart: now, usageCount: 0 },
    });
  }
  const limit = PLANS[shop.plan].ordersPerPeriod;
  const { count } = await prisma.shop.updateMany({
    where: { shop: shop.shop, usageCount: { lt: limit } },
    data: { usageCount: { increment: 1 } },
  });
  return count === 1;
}
