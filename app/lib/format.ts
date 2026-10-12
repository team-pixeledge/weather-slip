// Pure formatting shared by the snapshot builder (server) and the settings
// preview (client) — keep it free of server-only imports so both render the
// exact same text.
import { shortDay } from "./dates";
import type { SnapshotDay, WeatherSnapshot } from "./weather/types";

export type Unit = "C" | "F" | "BOTH";

export interface DisplaySettings {
  unit: Unit;
  showCurrent: boolean;
  showDispatch: boolean;
  showDelivery: boolean;
  showPrecip: boolean;
  showLocation: boolean;
}

export function cToF(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

function deg(c: number, unit: Unit): string {
  const rc = Math.round(c);
  if (unit === "C") return `${rc}°C`;
  if (unit === "F") return `${cToF(c)}°F`;
  return `${rc}°C / ${cToF(c)}°F`;
}

function range(minC: number, maxC: number, unit: Unit): string {
  const lo = Math.round(minC);
  const hi = Math.round(maxC);
  if (unit === "C") return `${lo}–${hi}°C`;
  if (unit === "F") return `${cToF(minC)}–${cToF(maxC)}°F`;
  return `${lo}–${hi}°C / ${cToF(minC)}–${cToF(maxC)}°F`;
}

function dayText(
  title: string,
  day: SnapshotDay,
  settings: DisplaySettings,
): string | null {
  if (day.status === "hidden") return null;
  const head = `${title} ${shortDay(day.date)}`;
  if (day.status === "beyond_horizon") return `${head}: forecast pending`;
  if (day.status !== "ok" || day.minC == null || day.maxC == null) return null;
  let text = `${head}: ${range(day.minC, day.maxC, settings.unit)}, ${day.label}`;
  if (settings.showPrecip && day.precipProb != null && day.precipProb >= 20) {
    text += `, ${day.precipProb}% rain`;
  }
  return text;
}

/**
 * One line of plain text for the order metafield. Plain text (no emoji, no
 * HTML) because it has to survive every invoice/packing-slip renderer,
 * including PDF generators with limited fonts.
 */
export function formatSummary(
  snap: Omit<WeatherSnapshot, "summary">,
  settings: DisplaySettings,
): string {
  const parts: string[] = [];
  if (settings.showLocation && snap.location.city) {
    parts.push(
      snap.location.countryCode
        ? `${snap.location.city}, ${snap.location.countryCode}`
        : snap.location.city,
    );
  }
  if (settings.showCurrent && snap.current) {
    parts.push(`Now ${deg(snap.current.tempC, settings.unit)}, ${snap.current.label}`);
  }
  if (settings.showDispatch) {
    const t = dayText("Dispatch", snap.dispatch, settings);
    if (t) parts.push(t);
  }
  if (settings.showDelivery) {
    const t = dayText("Delivery", snap.delivery, settings);
    if (t) parts.push(t);
  }
  return parts.join(" · ");
}
