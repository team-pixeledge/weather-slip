import { createHash } from "node:crypto";
import type { GeoPoint } from "./weather/types";

/**
 * Cache grid: 0.1° ≈ 11 km. Coarse enough that orders to the same town share
 * one forecast call, fine enough that a temperature is still meaningful, and
 * it means we never store an exact address-level coordinate.
 */
export function roundToGrid(point: GeoPoint): GeoPoint {
  return {
    lat: Math.round(point.lat * 10) / 10,
    lon: Math.round(point.lon * 10) / 10,
  };
}

export function cacheKey(provider: string, point: GeoPoint): string {
  const g = roundToGrid(point);
  return `${provider}:${g.lat.toFixed(1)}:${g.lon.toFixed(1)}`;
}

export interface AddressLike {
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  zip?: string | null;
  countryCode?: string | null;
  provinceCode?: string | null;
}

/**
 * Stable fingerprint of the *destination* (grid cell, or city/zip/country
 * when there are no coordinates). Lets orders/updated detect an address
 * change without the app ever storing the address. Street-level edits that
 * stay in the same grid cell intentionally don't count as a change.
 */
export function locationKey(addr: AddressLike): string | null {
  let basis: string;
  if (addr.latitude != null && addr.longitude != null) {
    const g = roundToGrid({ lat: addr.latitude, lon: addr.longitude });
    basis = `geo:${g.lat.toFixed(1)}:${g.lon.toFixed(1)}`;
  } else if (addr.city || addr.zip) {
    basis = [
      "addr",
      (addr.countryCode ?? "").toUpperCase(),
      (addr.zip ?? "").replace(/\s+/g, "").toUpperCase(),
      (addr.city ?? "").trim().toLowerCase(),
    ].join(":");
  } else {
    return null;
  }
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}
