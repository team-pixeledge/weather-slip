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
  /** Badge on the plan card (e.g. "Most popular"). */
  highlight?: string;
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
    highlight: "Most popular",
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

/** Short list for each plan card ("Everything in X, plus" style). */
export function planFeatures(id: PlanId): string[] {
  const p = PLANS[id];
  const orders = `${p.ordersPerPeriod.toLocaleString("en-US")} orders a month printed with weather`;
  if (id === "FREE") {
    return [
      orders,
      "Print one slip or many, plus a customer list",
      "All 4 slip templates",
      "Destination forecast for every day",
      "Reprints are always free",
    ];
  }
  if (id === "STARTER") {
    return [
      "Everything in Free, plus",
      orders,
      "Dispatch-day forecast in saved weather",
      "Weather on Shopify's packing slip, Order Printer and emails",
    ];
  }
  return ["Everything in Starter, plus", orders, "Use your own OpenWeather API key"];
}

/** Rows for the "Compare all features" table: label, then one cell per plan. */
export function comparisonRows(): [string, ...string[]][] {
  const yes = (b: boolean) => (b ? "✓" : "—");
  const each = (f: (p: PlanLimits) => string) => PLAN_ORDER.map((id) => f(PLANS[id]));
  return [
    ["Orders printed with weather / month", ...each((p) => p.ordersPerPeriod.toLocaleString("en-US"))],
    ["Reprints", ...each(() => "Free")],
    ["Bulk packing slips + customer list", ...each(() => "✓")],
    ["Slip templates (Classic, Minimal, Detailed, 4×6 label)", ...each(() => "✓")],
    ["Forecast for every day to delivery", ...each(() => "✓")],
    ["Dispatch-day forecast in saved weather", ...each((p) => yes(p.dispatchForecast))],
    ["Weather on Shopify's slip, Order Printer, emails", ...each((p) => (p.allTemplates ? "✓" : "Packing slip only"))],
    ["Your own OpenWeather API key", ...each((p) => yes(p.ownApiKey))],
  ];
}

export const USAGE_PERIOD_DAYS = 30;
