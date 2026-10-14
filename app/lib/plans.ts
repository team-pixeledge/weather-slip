// Plan limits and prices live here, and only here: shopify.server.ts builds
// the Billing API config from PLANS, and the Plans page renders from it.
// Plans count orders printed with weather (once per order), not API calls.
export type PlanId = "FREE" | "STARTER" | "PRO" | "BUSINESS";

export interface PlanLimits {
  name: string;
  priceUsd: number;
  ordersPerPeriod: number;
  /** Order Printer / email snippets and the print action. */
  allTemplates: boolean;
  dispatchForecast: boolean;
  /** One-line pitch for the Plans page. */
  tagline: string;
  /** Badge on the plan card (e.g. "Most popular"). */
  highlight?: string;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  FREE: {
    name: "Free",
    priceUsd: 0,
    ordersPerPeriod: 30,
    allTemplates: false,
    dispatchForecast: false,
    tagline: "For trying it out and small shops.",
  },
  STARTER: {
    name: "Starter",
    priceUsd: 4.99,
    ordersPerPeriod: 500,
    allTemplates: true,
    dispatchForecast: true,
    tagline: "For growing shops shipping every day.",
    highlight: "Most popular",
  },
  PRO: {
    name: "Pro",
    priceUsd: 9.99,
    ordersPerPeriod: 2000,
    allTemplates: true,
    dispatchForecast: true,
    tagline: "For busy shops shipping in volume.",
  },
  BUSINESS: {
    name: "Business",
    priceUsd: 19.99,
    ordersPerPeriod: 5000,
    allTemplates: true,
    dispatchForecast: true,
    tagline: "For high-volume brands shipping thousands of orders.",
  },
};

export const PLAN_ORDER: PlanId[] = ["FREE", "STARTER", "PRO", "BUSINESS"];
export const PAID_PLANS: PlanId[] = ["STARTER", "PRO", "BUSINESS"];

/** The Billing API subscription name for a paid plan ("Starter", "Pro", "Business"). */
export const billingName = (id: PlanId) => PLANS[id].name;

export function planFromBillingName(name: string): PlanId | null {
  return PAID_PLANS.find((id) => PLANS[id].name === name) ?? null;
}

/**
 * Every feature, for every plan card: included ones get a ✓, the rest are
 * shown faded so the cards compare side by side (no separate table).
 */
export function planFeatures(id: PlanId): { text: string; included: boolean }[] {
  const p = PLANS[id];
  return [
    { text: `${p.ordersPerPeriod.toLocaleString("en-US")} orders/month printed with weather`, included: true },
    { text: "Reprints always free", included: true },
    { text: "Print one slip or many + customer list", included: true },
    { text: "Print from Shopify's own Orders page", included: true },
    { text: "4 templates, fully customisable", included: true },
    { text: "Store logo, fonts, colours, paper sizes", included: true },
    { text: "Forecast for every day to delivery", included: true },
    { text: "Dispatch-day forecast in saved weather", included: p.dispatchForecast },
    { text: "Weather on Shopify's own packing slip", included: true },
    { text: "Order Printer & Order Printer Pro setup", included: p.allTemplates },
  ];
}

export const USAGE_PERIOD_DAYS = 30;
