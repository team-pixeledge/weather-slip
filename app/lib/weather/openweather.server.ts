import type {
  DailyForecast,
  ForecastPayload,
  GeocodeQuery,
  GeoPoint,
  WeatherProvider,
} from "./types";

// OpenWeather free plan (2026-10): 60 calls/min, 1M calls/month, Current
// Weather + 5 day / 3 hour Forecast + Geocoding. The 16-day Daily Forecast is
// paid-only (Startup and up), so on the free plan dates more than ~4 days out
// are "beyond_horizon" and get filled later by the pending-fill job.
const BASE = "https://api.openweathermap.org";
const TIMEOUT_MS = 8_000;

class HttpError extends Error {
  constructor(readonly status: number, path: string) {
    // Never include the URL: it carries the appid.
    super(`OpenWeather ${path} responded ${status}`);
  }
}

interface CurrentResponse {
  dt: number;
  timezone: number; // seconds offset from UTC at the location
  main: { temp: number };
  weather: { id: number; description: string }[];
}

interface ForecastResponse {
  city: { timezone: number };
  list: {
    dt: number;
    main: { temp_min: number; temp_max: number };
    weather: { id: number; description: string }[];
    pop?: number; // 0–1
  }[];
}

type GeoResponse = { lat: number; lon: number }[] | { lat: number; lon: number };

function capitalise(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** The location's calendar date for a unix time, given its UTC offset. */
function dateAt(unix: number, offsetSec: number): string {
  return new Date((unix + offsetSec) * 1000).toISOString().slice(0, 10);
}

/**
 * Collapse 3-hour slots into days: min of lows, max of highs, max rain
 * probability, and the condition of the slot nearest local midday. A day
 * with too few slots (the partial last day) is dropped rather than reported
 * with a misleading range — except today, which is always partial.
 */
export function aggregateDaily(res: ForecastResponse, today: string): DailyForecast[] {
  const offset = res.city.timezone;
  const byDate = new Map<string, ForecastResponse["list"]>();
  for (const slot of res.list) {
    const date = dateAt(slot.dt, offset);
    byDate.set(date, [...(byDate.get(date) ?? []), slot]);
  }
  const days: DailyForecast[] = [];
  for (const [date, slots] of byDate) {
    if (slots.length < 4 && date !== today) continue;
    const midday = slots.reduce((best, s) => {
      const hour = new Date((s.dt + offset) * 1000).getUTCHours();
      const bestHour = new Date((best.dt + offset) * 1000).getUTCHours();
      return Math.abs(hour - 12) < Math.abs(bestHour - 12) ? s : best;
    });
    const pops = slots.map((s) => s.pop).filter((p): p is number => p != null);
    days.push({
      date,
      minC: Math.min(...slots.map((s) => s.main.temp_min)),
      maxC: Math.max(...slots.map((s) => s.main.temp_max)),
      precipProb: pops.length ? Math.round(Math.max(...pops) * 100) : null,
      code: midday.weather[0]?.id ?? 0,
      label: capitalise(midday.weather[0]?.description ?? ""),
    });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

export class OpenWeatherProvider implements WeatherProvider {
  readonly id = "openweather";
  /** Today + 4: the last complete day inside the 5-day / 3-hour window. */
  readonly horizonDays = 4;

  /**
   * `keys` are tried in order; the next one is used only when a key is
   * rejected (401 — revoked or not yet active). A 429 is NOT failed over:
   * keys on one account share a quota, and spreading load across accounts
   * to dodge limits risks suspension. The job retries with backoff instead.
   */
  constructor(
    private readonly keys: string[],
    /** Monitoring hook: every attempt's HTTP status (or "timeout"). */
    private readonly onCall?: (path: string, status: number | "timeout") => void,
  ) {
    if (keys.length === 0) throw new Error("No OpenWeather API key configured");
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    let lastError: unknown;
    for (const key of this.keys) {
      const url = new URL(path, BASE);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      url.searchParams.set("appid", key);
      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (err) {
        this.onCall?.(path, "timeout");
        throw err;
      }
      this.onCall?.(path, res.status);
      if (res.ok) return (await res.json()) as T;
      lastError = new HttpError(res.status, path);
      if (res.status !== 401) break;
    }
    throw lastError;
  }

  async forecast(point: GeoPoint): Promise<ForecastPayload> {
    const coords = { lat: String(point.lat), lon: String(point.lon), units: "metric" };
    const [current, forecast] = await Promise.all([
      this.get<CurrentResponse>("/data/2.5/weather", coords),
      this.get<ForecastResponse>("/data/2.5/forecast", coords),
    ]);
    const offset = current.timezone;
    const today = dateAt(current.dt, offset);
    return {
      provider: this.id,
      // OpenWeather gives an offset, not an IANA zone. Keep the exact offset
      // (India is +5:30, Nepal +5:45) — rounding it would put "today" on the
      // wrong date near midnight.
      timezone: offsetLabel(offset),
      utcOffsetSec: offset,
      current: {
        tempC: current.main.temp,
        code: current.weather[0]?.id ?? 0,
        label: capitalise(current.weather[0]?.description ?? ""),
        observedAt: new Date((current.dt + offset) * 1000).toISOString().slice(0, 16),
      },
      daily: aggregateDaily(forecast, today),
    };
  }

  async geocode(query: GeocodeQuery): Promise<GeoPoint | null> {
    // Postcode is more precise than a city name when we have both.
    if (query.zip && query.countryCode) {
      try {
        const z = await this.get<GeoResponse>("/geo/1.0/zip", {
          zip: `${query.zip.replace(/\s+/g, "")},${query.countryCode}`,
        });
        if (!Array.isArray(z)) return { lat: z.lat, lon: z.lon };
      } catch (err) {
        if (!(err instanceof HttpError && err.status === 404)) throw err;
      }
    }
    if (!query.city) return null;
    const q = query.countryCode ? `${query.city},${query.countryCode}` : query.city;
    const hits = await this.get<GeoResponse>("/geo/1.0/direct", { q, limit: "1" });
    const hit = Array.isArray(hits) ? hits[0] : hits;
    return hit ? { lat: hit.lat, lon: hit.lon } : null;
  }
}

export function offsetLabel(offsetSec: number): string {
  const sign = offsetSec < 0 ? "-" : "+";
  const abs = Math.abs(offsetSec);
  const hh = String(Math.floor(abs / 3600)).padStart(2, "0");
  const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}
