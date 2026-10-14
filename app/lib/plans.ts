// Plan limits, prices and features live here, and only here: billing,
// every server-side gate and the Plans page all read PLANS.
// Plans count prints with weather — every order on every print, reprints
// included (user decision 2026-10-14) — not API calls.
import type { OrderView } from "./order-views";
import { WATERMARK_PRESETS, type SlipOptions, type SlipTemplate } from "./slip";

export type PlanId = "FREE" | "STARTER" | "PRO" | "BUSINESS";
export type BillingInterval = "MONTHLY" | "ANNUAL";

export interface PlanLimits {
  name: string;
  priceUsd: number;
  /** Yearly price (billed once a year by Shopify); 0 for Free. */
  annualPriceUsd: number;
  ordersPerPeriod: number;
  /** Slip templates this plan may print (and pick as its default). */
  templates: SlipTemplate[];
  /** Orders page tabs; the first is the default view. */
  orderViews: OrderView[];
  /** Order Printer / Order Printer Pro snippet setup. */
  allTemplates: boolean;
  dispatchForecast: boolean;
  /** Forecast days after today on slips and the saved summary (provider max 4). */
  forecastDaysAhead: number;
  /** Print action in Shopify's own Orders section. */
  printFromShopify: boolean;
  customerList: boolean;
  /** Print slips in another language. */
  languages: boolean;
  /** Distance from the fulfillment location on the slip. */
  distance: boolean;
  /** Shopify Flow action: save an order's weather when it's paid/fulfilled. */
  flowAutomation: boolean;
  /** Ask us to build a template around your brand. */
  customTemplateRequest: boolean;
  /** May hide the "Weather Slip" mark printed at the foot of each page. */
  removeBranding: boolean;
  /** Merchant watermark: none / preset words / any text / logo or text. */
  watermark: "none" | "preset" | "custom" | "logo";
  /** One-line pitch for the Plans page. */
  tagline: string;
  /** Badge on the plan card (e.g. "Most popular"). */
  highlight?: string;
}

const ALL_VIEWS: OrderView[] = ["all", "unfulfilled", "unpaid", "open", "archived", "cancelled"];

export const PLANS: Record<PlanId, PlanLimits> = {
  FREE: {
    name: "Free",
    priceUsd: 0,
    annualPriceUsd: 0,
    ordersPerPeriod: 30,
    templates: ["CLASSIC"],
    orderViews: ["unfulfilled"],
    allTemplates: false,
    dispatchForecast: false,
    forecastDaysAhead: 2,
    printFromShopify: false,
    customerList: false,
    languages: false,
    distance: false,
    flowAutomation: false,
    customTemplateRequest: false,
    removeBranding: false,
    watermark: "none",
    tagline: "For trying it out and small shops.",
  },
  STARTER: {
    name: "Starter",
    priceUsd: 4.99,
    annualPriceUsd: 49,
    ordersPerPeriod: 500,
    templates: ["CLASSIC", "MINIMAL"],
    orderViews: ["unfulfilled"],
    allTemplates: true,
    dispatchForecast: true,
    forecastDaysAhead: 2,
    printFromShopify: true,
    customerList: true,
    languages: false,
    distance: false,
    flowAutomation: false,
    customTemplateRequest: false,
    removeBranding: false,
    watermark: "preset",
    tagline: "For growing shops shipping every day.",
  },
  PRO: {
    name: "Pro",
    priceUsd: 9.99,
    annualPriceUsd: 99,
    ordersPerPeriod: 2000,
    templates: ["CLASSIC", "MINIMAL", "DETAILED"],
    orderViews: ALL_VIEWS,
    allTemplates: true,
    dispatchForecast: true,
    forecastDaysAhead: 3,
    printFromShopify: true,
    customerList: true,
    languages: true,
    distance: true,
    flowAutomation: true,
    customTemplateRequest: false,
    removeBranding: false,
    watermark: "custom",
    tagline: "For busy shops shipping in volume.",
    highlight: "Most popular",
  },
  BUSINESS: {
    name: "Business",
    priceUsd: 19.99,
    annualPriceUsd: 199,
    ordersPerPeriod: 5000,
    templates: ["CLASSIC", "MINIMAL", "DETAILED", "LABEL_4X6"],
    orderViews: ALL_VIEWS,
    allTemplates: true,
    dispatchForecast: true,
    forecastDaysAhead: 4,
    printFromShopify: true,
    customerList: true,
    languages: true,
    distance: true,
    flowAutomation: true,
    customTemplateRequest: true,
    removeBranding: true,
    watermark: "logo",
    tagline: "For high-volume brands shipping thousands of orders.",
  },
};

export const PLAN_ORDER: PlanId[] = ["FREE", "STARTER", "PRO", "BUSINESS"];
export const PAID_PLANS: PlanId[] = ["STARTER", "PRO", "BUSINESS"];

/** The cheapest plan that has a feature (for "Available on Pro and up"). */
export function lowestPlanWith(has: (p: PlanLimits) => boolean): PlanId {
  return PLAN_ORDER.find((id) => has(PLANS[id])) ?? "BUSINESS";
}

/** "Pro and Business", "Business", "Starter, Pro and Business". */
export function plansWith(has: (p: PlanLimits) => boolean): string {
  const names = PLAN_ORDER.filter((id) => has(PLANS[id])).map((id) => PLANS[id].name);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
}

/** The cheapest plan that includes a template. */
export const templatePlan = (t: SlipTemplate): PlanId => lowestPlanWith((p) => p.templates.includes(t));

/**
 * Billing API subscription name: "Pro" (monthly) or "Pro (yearly)". The
 * name is how syncPlan maps Shopify's active subscription back to a plan
 * and interval, so don't rename existing ones.
 */
export const billingName = (id: PlanId, interval: BillingInterval = "MONTHLY") =>
  interval === "ANNUAL" ? `${PLANS[id].name} (yearly)` : PLANS[id].name;

export function planFromBillingName(name: string): PlanId | null {
  return PAID_PLANS.find((id) => name === billingName(id) || name === billingName(id, "ANNUAL")) ?? null;
}

export const intervalFromBillingName = (name: string): BillingInterval =>
  name.endsWith("(yearly)") ? "ANNUAL" : "MONTHLY";

/** Yearly saving vs 12 monthly payments, in whole percent. */
export function annualSavingPct(id: PlanId): number {
  const p = PLANS[id];
  if (!p.priceUsd) return 0;
  return Math.round((1 - p.annualPriceUsd / (p.priceUsd * 12)) * 100);
}

/**
 * The slip options as this plan may print them. Settings are stored as the
 * merchant chose them (so a downgrade and re-upgrade loses nothing) and
 * clamped here at every render: a template the plan lacks falls back to
 * Classic, and language, distance and hiding the mark need their plan.
 */
export function planSlipOptions(o: SlipOptions, plan: PlanId): SlipOptions {
  const p = PLANS[plan];
  return {
    ...o,
    template: p.templates.includes(o.template) ? o.template : "CLASSIC",
    design: {
      ...o.design,
      language: p.languages ? o.design.language : "en",
      showDistance: p.distance && o.design.showDistance,
      showDispatch: p.dispatchForecast && o.design.showDispatch,
      maxDaysAhead: p.forecastDaysAhead,
      showBranding: p.removeBranding ? o.design.showBranding : true,
      ...planWatermark(o, p.watermark),
    },
  };
}

/** The watermark a plan may print: anything beyond its tier is dropped. */
function planWatermark(o: SlipOptions, tier: PlanLimits["watermark"]): Pick<SlipOptions["design"], "watermark"> {
  const d = o.design;
  if (d.watermark === "logo") return { watermark: tier === "logo" ? "logo" : "none" };
  if (d.watermark === "text") {
    const preset = (WATERMARK_PRESETS as readonly string[]).includes((d.watermarkText ?? "").trim().toUpperCase());
    const ok = tier === "custom" || tier === "logo" || (tier === "preset" && preset);
    return { watermark: ok ? "text" : "none" };
  }
  return { watermark: "none" };
}

/**
 * Free and Starter work with unfulfilled (incl. partially fulfilled) orders
 * only — the Orders list enforces it, and so does printing, because Starter
 * can also print from Shopify's own Orders page. A reprint of an order
 * printed before it shipped/closed is always allowed.
 */
export function planAllowsOrder(
  plan: PlanId,
  order: { displayFulfillmentStatus: string; cancelledAt?: string | null; closed?: boolean },
  printedBefore: boolean,
): boolean {
  if (PLANS[plan].orderViews.length > 1 || printedBefore) return true;
  return !order.cancelledAt && !order.closed && !["FULFILLED", "RESTOCKED"].includes(order.displayFulfillmentStatus);
}

/** A view this plan may open; anything else falls back to its default. */
export function allowedView(view: OrderView, plan: PlanId): OrderView {
  const views = PLANS[plan].orderViews;
  return views.includes(view) ? view : views[0]!;
}

/**
 * Every feature, for every plan card: included ones (✓) first, then the
 * rest faded, so each card reads as "what you get, then what's more".
 */
export function planFeatures(id: PlanId): { text: string; included: boolean }[] {
  const p = PLANS[id];
  const n = p.templates.length;
  const all = [
    { text: `${p.ordersPerPeriod.toLocaleString("en-US")} slip prints/month with weather`, included: true },
    { text: "Each print and reprint counts once per order", included: true },
    {
      text:
        n === 1
          ? "1 slip template (Classic)"
          : n === 4
            ? "All 4 slip templates incl. 4×6 shipping label"
            : `${n} slip templates (${n === 2 ? "+ Minimal ink saver" : "+ Detailed with prices"})`,
      included: true,
    },
    {
      text: `Forecast for today + ${p.forecastDaysAhead} days${p.forecastDaysAhead >= 4 ? " (the most)" : ""}`,
      included: true,
    },
    { text: "Store logo, fonts, colours, paper sizes", included: true },
    { text: "Weather on Shopify's own packing slip", included: true },
    { text: "Unfulfilled orders", included: true },
    { text: "All orders: fulfilled, unpaid, cancelled, archived", included: p.orderViews.length > 1 },
    { text: "Dispatch-day forecast in saved weather", included: p.dispatchForecast },
    { text: "Print from Shopify's own Orders page", included: p.printFromShopify },
    { text: "Customer list printout", included: p.customerList },
    { text: "Order Printer & Order Printer Pro setup guide", included: p.allTemplates },
    { text: "Slips in 7 languages", included: p.languages },
    { text: "Distance to the customer on the slip", included: p.distance },
    { text: "Shopify Flow: save weather when paid or fulfilled", included: p.flowAutomation },
    { text: "Custom template built for your brand", included: p.customTemplateRequest },
    { text: "Remove the Weather Slip mark from prints", included: p.removeBranding },
    { text: "Watermark: PAID, FRAGILE, GIFT…", included: p.watermark !== "none" },
    { text: "Watermark with your own text", included: p.watermark === "custom" || p.watermark === "logo" },
    { text: "Watermark with your logo", included: p.watermark === "logo" },
  ];
  // Included first (user request 2026-10-14), each group in list order.
  return [...all.filter((f) => f.included), ...all.filter((f) => !f.included)];
}

export const USAGE_PERIOD_DAYS = 30;
