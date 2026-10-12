import type {
  ForecastPayload,
  GeocodeQuery,
  GeoPoint,
  WeatherProvider,
} from "./types";
import { wmoLabel } from "./wmo";

// Open-Meteo's free endpoints are for non-commercial use only. With an API
// key (ours via OPEN_METEO_API_KEY, or a Pro merchant's own) requests go to
// the customer-* hosts, which is what a paid listing must use in production.
const FREE = {
  forecast: "https://api.open-meteo.com/v1/forecast",
  geocode: "https://geocoding-api.open-meteo.com/v1/search",
};
const CUSTOMER = {
  forecast: "https://customer-api.open-meteo.com/v1/forecast",
  geocode: "https://customer-geocoding-api.open-meteo.com/v1/search",
};

const TIMEOUT_MS = 8_000;

interface ForecastResponse {
  timezone: string;
  current?: { time: string; temperature_2m: number; weather_code: number };
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max?: (number | null)[];
  };
}

interface GeocodeResponse {
  results?: { latitude: number; longitude: number; country_code?: string }[];
}

async function getJson<T>(url: URL): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    // Never echo the URL: it may carry the API key.
    throw new Error(`Open-Meteo ${url.pathname} responded ${res.status}`);
  }
  return (await res.json()) as T;
}

export class OpenMeteoProvider implements WeatherProvider {
  readonly id = "open-meteo";
  readonly horizonDays = 15; // 16 forecast days including today

  constructor(private readonly apiKey?: string | null) {}

  private hosts() {
    return this.apiKey ? CUSTOMER : FREE;
  }

  private withKey(url: URL): URL {
    if (this.apiKey) url.searchParams.set("apikey", this.apiKey);
    return url;
  }

  async forecast(point: GeoPoint): Promise<ForecastPayload> {
    const url = new URL(this.hosts().forecast);
    url.searchParams.set("latitude", String(point.lat));
    url.searchParams.set("longitude", String(point.lon));
    url.searchParams.set("current", "temperature_2m,weather_code");
    url.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    );
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", "16");
    // A few past days so a backfilled/late order still gets its dispatch day.
    url.searchParams.set("past_days", "7");
    const data = await getJson<ForecastResponse>(this.withKey(url));

    const d = data.daily;
    return {
      provider: this.id,
      timezone: data.timezone,
      current: data.current
        ? {
            tempC: data.current.temperature_2m,
            code: data.current.weather_code,
            label: wmoLabel(data.current.weather_code),
            observedAt: data.current.time,
          }
        : null,
      daily: d
        ? d.time.map((date, i) => ({
            date,
            minC: d.temperature_2m_min[i]!,
            maxC: d.temperature_2m_max[i]!,
            precipProb: d.precipitation_probability_max?.[i] ?? null,
            code: d.weather_code[i]!,
            label: wmoLabel(d.weather_code[i]!),
          }))
        : [],
    };
  }

  async geocode(query: GeocodeQuery): Promise<GeoPoint | null> {
    // Open-Meteo geocodes place names, not postcodes reliably — city first,
    // narrowed by country.
    if (!query.city) return null;
    const url = new URL(this.hosts().geocode);
    url.searchParams.set("name", query.city);
    url.searchParams.set("count", "1");
    if (query.countryCode) url.searchParams.set("countryCode", query.countryCode);
    const data = await getJson<GeocodeResponse>(this.withKey(url));
    const hit = data.results?.[0];
    return hit ? { lat: hit.latitude, lon: hit.longitude } : null;
  }
}
