import type { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import { cacheKey, roundToGrid } from "../location";
import type { ForecastPayload, GeocodeQuery, GeoPoint, WeatherProvider } from "./types";

// Forecast models update every few hours; 3h keeps "Now" honest while still
// letting a busy shop's orders to one city share a single call.
export const FORECAST_TTL_MS = 3 * 60 * 60 * 1000;
// Geocodes don't change; keep them for a month.
export const GEOCODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * One forecast call per grid cell per TTL, shared across every shop. Callers
 * pass the merchant's provider instance, but the cache key only depends on
 * the provider id — a merchant's own key buys freshness quota, not a
 * different answer.
 */
export async function cachedForecast(
  provider: WeatherProvider,
  point: GeoPoint,
  now = new Date(),
): Promise<ForecastPayload> {
  const key = cacheKey(provider.id, point);
  const hit = await prisma.weatherCache.findUnique({ where: { key } });
  if (hit && hit.expiresAt > now) return hit.payload as unknown as ForecastPayload;

  const payload = await provider.forecast(roundToGrid(point));
  const data = {
    provider: provider.id,
    payload: payload as unknown as Prisma.InputJsonValue,
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + FORECAST_TTL_MS),
  };
  await prisma.weatherCache.upsert({
    where: { key },
    create: { key, ...data },
    update: data,
  });
  return payload;
}

export async function cachedGeocode(
  provider: WeatherProvider,
  query: GeocodeQuery,
  now = new Date(),
): Promise<GeoPoint | null> {
  const key = [
    "geo",
    provider.id,
    (query.countryCode ?? "").toUpperCase(),
    (query.zip ?? "").replace(/\s+/g, "").toUpperCase(),
    query.city.trim().toLowerCase(),
  ].join(":");
  const hit = await prisma.weatherCache.findUnique({ where: { key } });
  if (hit && hit.expiresAt > now) {
    return (hit.payload as unknown as { point: GeoPoint | null }).point;
  }
  const point = await provider.geocode(query);
  const data = {
    provider: provider.id,
    payload: { point } as unknown as Prisma.InputJsonValue,
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + GEOCODE_TTL_MS),
  };
  await prisma.weatherCache.upsert({
    where: { key },
    create: { key, ...data },
    update: data,
  });
  return point;
}

export async function pruneExpiredCache(now = new Date()): Promise<number> {
  const { count } = await prisma.weatherCache.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return count;
}
