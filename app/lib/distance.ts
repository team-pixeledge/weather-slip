// Distance from the fulfillment location to the destination, for the
// packing slip. Pure (no server imports): the slip preview renders in the
// browser with the same code.

export type DistanceUnit = "km" | "mi" | "nmi";

export const DISTANCE_UNITS: { id: DistanceUnit; label: string; suffix: string; perKm: number }[] = [
  { id: "km", label: "Kilometres (km)", suffix: "km", perKm: 1 },
  { id: "mi", label: "Miles (mi)", suffix: "mi", perKm: 1 / 1.609344 },
  { id: "nmi", label: "Nautical miles (nmi)", suffix: "nmi", perKm: 1 / 1.852 },
];

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_KM = 6371.0088; // mean radius (IUGG)

/** Great-circle ("as the crow flies") distance in km — not road distance. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "1,234 km", "8.4 mi" (one decimal under 10). */
export function formatDistance(km: number, unit: DistanceUnit): string {
  const u = DISTANCE_UNITS.find((x) => x.id === unit) ?? DISTANCE_UNITS[0]!;
  const v = km * u.perKm;
  const n = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: v < 10 ? 1 : 0,
  }).format(v);
  return `${n} ${u.suffix}`;
}

/**
 * One origin → destination distance on a slip. An order split across
 * locations gets one per location. `from` is the place (city, country),
 * never the location's internal name.
 */
export type SlipDistance =
  | { status: "ok"; km: number; from: string }
  | { status: "unavailable"; reason: "no_origin" | "no_destination" };
