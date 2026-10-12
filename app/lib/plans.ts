// Plan limits live in code; prices are mirrored in the Partner Dashboard /
// Billing API config (Phase 4). Keep the two in step.
export type PlanId = "FREE" | "STARTER" | "PRO";

export interface PlanLimits {
  name: string;
  priceUsd: number;
  ordersPerPeriod: number;
  /** Order Printer / email snippets and the print action. */
  allTemplates: boolean;
  dispatchForecast: boolean;
  ownApiKey: boolean;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  FREE: {
    name: "Free",
    priceUsd: 0,
    ordersPerPeriod: 50,
    allTemplates: false,
    dispatchForecast: false,
    ownApiKey: false,
  },
  STARTER: {
    name: "Starter",
    priceUsd: 4.99,
    ordersPerPeriod: 500,
    allTemplates: true,
    dispatchForecast: true,
    ownApiKey: false,
  },
  PRO: {
    name: "Pro",
    priceUsd: 9.99,
    ordersPerPeriod: 3000,
    allTemplates: true,
    dispatchForecast: true,
    ownApiKey: true,
  },
};

export const USAGE_PERIOD_DAYS = 30;
