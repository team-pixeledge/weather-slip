// Provider-neutral weather shapes. Everything is stored in Celsius; °F is
// derived at format time so a unit change never needs a refetch.

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface CurrentConditions {
  tempC: number;
  code: number; // provider-specific condition code
  label: string; // short, printable ("Light rain")
  observedAt: string; // ISO, destination-local as returned by the provider
}

export interface DailyForecast {
  date: string; // YYYY-MM-DD, destination-local
  minC: number;
  maxC: number;
  precipProb: number | null; // 0–100
  code: number;
  label: string;
}

export interface ForecastPayload {
  provider: string;
  timezone: string; // IANA zone, or a "UTC+05:30" label when only an offset is known
  /** Exact UTC offset at the destination, when the provider gives one. */
  utcOffsetSec?: number;
  current: CurrentConditions | null;
  daily: DailyForecast[]; // a few past days + up to 16 ahead
}

export interface GeocodeQuery {
  city: string;
  countryCode?: string | null;
  zip?: string | null;
}

export interface WeatherProvider {
  readonly id: string;
  /** Furthest day ahead the provider forecasts, counting today as 0. */
  readonly horizonDays: number;
  forecast(point: GeoPoint): Promise<ForecastPayload>;
  geocode(query: GeocodeQuery): Promise<GeoPoint | null>;
}

// What lands in the order metafield (and the snapshot row's payload).
export type DayStatus = "ok" | "beyond_horizon" | "unavailable" | "hidden";

export interface SnapshotDay {
  date: string;
  status: DayStatus;
  minC?: number;
  maxC?: number;
  minF?: number;
  maxF?: number;
  precipProb?: number | null;
  code?: number;
  label?: string;
}

export interface WeatherSnapshot {
  schema: 1;
  provider: string;
  fetchedAt: string;
  location: {
    city: string | null;
    countryCode: string | null;
    lat: number; // rounded to the cache grid, not the exact address
    lon: number;
  };
  current: {
    tempC: number;
    tempF: number;
    code: number;
    label: string;
    observedAt: string;
  } | null;
  dispatch: SnapshotDay;
  delivery: SnapshotDay;
  summary: string;
}
