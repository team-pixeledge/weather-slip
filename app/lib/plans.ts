// Plan limits and prices live here, and only here: shopify.server.ts builds
// the Billing API config from PLANS, and the Plans page renders from it.
// Plans count orders printed with weather (once per order), not API calls.
export type PlanId = "FREE" | "STARTER" | "PRO";

export interface PlanLimits {
  name: string;
  priceUsd: number;
  ordersPerPeriod: number;
  /** Order Printer / email snippets and the print action. */
  allTemplates: boolean;
  dispatchForecast: boolean;
  ownApiKey: boolean;
  /** One-line pitch for the Plans page. */
  tagline: string;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  FREE: {
    name: "Free",
    priceUsd: 0,
    ordersPerPeriod: 50,
    allTemplates: false,
    dispatchForecast: false,
    ownApiKey: false,
    tagline: "For trying it out and small shops.",
  },
  STARTER: {
    name: "Starter",
    priceUsd: 4.99,
    ordersPerPeriod: 500,
    allTemplates: true,
    dispatchForecast: true,
    ownApiKey: false,
    tagline: "For growing shops shipping every day.",
  },
  PRO: {
    name: "Pro",
    priceUsd: 9.99,
    ordersPerPeriod: 3000,
    allTemplates: true,
    dispatchForecast: true,
    ownApiKey: true,
    tagline: "For high-volume shops.",
  },
};

export const PLAN_ORDER: PlanId[] = ["FREE", "STARTER", "PRO"];
export const PAID_PLANS: PlanId[] = ["STARTER", "PRO"];

/** The Billing API subscription name for a paid plan ("Starter", "Pro"). */
export const billingName = (id: PlanId) => PLANS[id].name;

export function planFromBillingName(name: string): PlanId | null {
  return PAID_PLANS.find((id) => PLANS[id].name === name) ?? null;
}

/** What each plan includes, for the comparison on the Plans page. */
export function planFeatures(id: PlanId): string[] {
  const p = PLANS[id];
  return [
    `${p.ordersPerPeriod.toLocaleString("en-US")} orders a month printed with weather`,
    "Reprints are always free",
    "Bulk packing slips and customer list",
    "Destination forecast for every day, delivery day marked",
    p.dispatchForecast ? "Dispatch-day forecast in saved weather" : null,
    p.allTemplates
      ? "Weather on Shopify packing slips, Order Printer and emails"
      : "Weather on Shopify's packing slip",
    p.ownApiKey ? "Use your own OpenWeather API key" : null,
  ].filter((f): f is string => f != null);
}

export const USAGE_PERIOD_DAYS = 30;
