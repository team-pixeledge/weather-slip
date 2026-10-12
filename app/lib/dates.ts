// Calendar-date maths on plain YYYY-MM-DD strings. Dates are deliberately not
// Date objects: a packing slip cares about "which day", and carrying a time
// of day through timezone conversions is how off-by-one-day bugs happen.

export type IsoDate = string;

/** The calendar date of `instant` in the given IANA timezone. */
export function localDate(instant: Date, timeZone: string): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function toUtc(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

export function isWeekend(date: IsoDate): boolean {
  const day = toUtc(date).getUTCDay();
  return day === 0 || day === 6;
}

/** Move forward to the next weekday if `date` falls on a weekend. */
export function nextWeekday(date: IsoDate): IsoDate {
  let d = date;
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

/**
 * Add `days` days, counting only weekdays when `skipWeekends` is set.
 * The result is always a weekday in that mode, even for days = 0.
 */
export function addWorkingDays(
  date: IsoDate,
  days: number,
  skipWeekends: boolean,
): IsoDate {
  if (!skipWeekends) return addDays(date, days);
  let d = nextWeekday(date);
  let remaining = days;
  while (remaining > 0) {
    d = addDays(d, 1);
    if (!isWeekend(d)) remaining--;
  }
  return d;
}

/** Whole days from `a` to `b` (positive if b is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export interface ShippingDateSettings {
  handlingDays: number;
  transitDays: number;
  skipWeekends: boolean;
}

export interface ShippingDateFacts {
  orderDate: IsoDate;
  /** Date the first fulfillment was created, if the order has shipped. */
  fulfilledDate?: IsoDate | null;
  /** Carrier/merchant estimate from the fulfillment, if Shopify has one. */
  estimatedDeliveryDate?: IsoDate | null;
}

/**
 * Dispatch = actual fulfillment date, else order date + handling days.
 * Delivery = the fulfillment's estimate, else dispatch + transit days.
 */
export function shippingDates(
  facts: ShippingDateFacts,
  settings: ShippingDateSettings,
): { dispatch: IsoDate; delivery: IsoDate } {
  const dispatch =
    facts.fulfilledDate ??
    addWorkingDays(facts.orderDate, settings.handlingDays, settings.skipWeekends);
  const delivery =
    facts.estimatedDeliveryDate ??
    addWorkingDays(dispatch, settings.transitDays, settings.skipWeekends);
  return { dispatch, delivery };
}

/** "Thu 17 Oct" — short enough for a slip, unambiguous across locales. */
export function shortDay(date: IsoDate): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(toUtc(date));
}
