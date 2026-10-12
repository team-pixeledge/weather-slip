import { addDays, localDate, type IsoDate } from "./dates";
import { cToF, formatSummary, type DisplaySettings } from "./format";
import { roundToGrid } from "./location";
import type {
  ForecastPayload,
  GeoPoint,
  SnapshotDay,
  WeatherSnapshot,
} from "./weather/types";

/** Today's date at the destination — forecast dates are destination-local. */
export function destinationToday(forecast: ForecastPayload, now: Date): IsoDate {
  if (forecast.utcOffsetSec != null) {
    return new Date(now.getTime() + forecast.utcOffsetSec * 1000).toISOString().slice(0, 10);
  }
  try {
    return localDate(now, forecast.timezone || "UTC");
  } catch {
    return localDate(now, "UTC");
  }
}

export interface BuildSnapshotInput {
  forecast: ForecastPayload;
  horizonDays: number;
  point: GeoPoint;
  city: string | null;
  countryCode: string | null;
  dispatch: IsoDate;
  delivery: IsoDate;
  /** Today at the destination (forecast dates are destination-local). */
  today: IsoDate;
  settings: DisplaySettings;
  /** Plan allows the dispatch-day forecast. */
  dispatchAllowed: boolean;
  now: Date;
}

function day(
  forecast: ForecastPayload,
  date: IsoDate,
  today: IsoDate,
  horizonDays: number,
): SnapshotDay {
  const d = forecast.daily.find((x) => x.date === date);
  if (d) {
    return {
      date,
      status: "ok",
      minC: d.minC,
      maxC: d.maxC,
      minF: cToF(d.minC),
      maxF: cToF(d.maxC),
      precipProb: d.precipProb,
      code: d.code,
      label: d.label,
    };
  }
  if (date > addDays(today, horizonDays)) return { date, status: "beyond_horizon" };
  return { date, status: "unavailable" };
}

export function buildSnapshot(input: BuildSnapshotInput): WeatherSnapshot {
  const { forecast, settings } = input;
  const dispatch: SnapshotDay = input.dispatchAllowed
    ? day(forecast, input.dispatch, input.today, input.horizonDays)
    : { date: input.dispatch, status: "hidden" };
  const delivery = day(forecast, input.delivery, input.today, input.horizonDays);

  const base: Omit<WeatherSnapshot, "summary"> = {
    schema: 1,
    provider: forecast.provider,
    fetchedAt: input.now.toISOString(),
    location: {
      city: input.city,
      countryCode: input.countryCode,
      ...roundToGrid(input.point),
    },
    current: forecast.current
      ? {
          tempC: forecast.current.tempC,
          tempF: cToF(forecast.current.tempC),
          code: forecast.current.code,
          label: forecast.current.label,
          observedAt: forecast.current.observedAt,
        }
      : null,
    dispatch,
    delivery,
  };
  return { ...base, summary: formatSummary(base, settings) };
}

/**
 * Fill only the days that were beyond the horizon. Days already printed as
 * "ok" (and the "Now" reading) keep their original values, so a reprint
 * changes "forecast pending" into numbers and nothing else.
 */
export function fillPendingDays(
  prev: WeatherSnapshot,
  forecast: ForecastPayload,
  today: IsoDate,
  horizonDays: number,
  settings: DisplaySettings,
): WeatherSnapshot {
  const refill = (d: SnapshotDay) =>
    d.status === "beyond_horizon" ? day(forecast, d.date, today, horizonDays) : d;
  const base: Omit<WeatherSnapshot, "summary"> = {
    schema: prev.schema,
    provider: prev.provider,
    fetchedAt: prev.fetchedAt,
    location: prev.location,
    current: prev.current,
    dispatch: refill(prev.dispatch),
    delivery: refill(prev.delivery),
  };
  return { ...base, summary: formatSummary(base, settings) };
}

/** True if any day still needs a later fetch to fill in. */
export function hasPendingDays(snap: WeatherSnapshot): boolean {
  return (
    snap.dispatch.status === "beyond_horizon" ||
    snap.delivery.status === "beyond_horizon"
  );
}

/**
 * When to retry a pending snapshot: the day the earliest pending date enters
 * the forecast window (minus a day of slack).
 */
export function nextFillDate(
  snap: WeatherSnapshot,
  horizonDays: number,
): IsoDate | null {
  const pending = [snap.dispatch, snap.delivery]
    .filter((d) => d.status === "beyond_horizon")
    .map((d) => d.date)
    .sort();
  if (pending.length === 0) return null;
  return addDays(pending[0]!, -(horizonDays - 1));
}
