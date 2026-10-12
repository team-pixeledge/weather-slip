import type { Plan } from "@prisma/client";
import prisma from "../db.server";
import type { GraphqlClient } from "./orders.server";
import { planFromBillingName, type PlanId } from "./plans";

/**
 * Test charges (no money moves) until SHOPIFY_BILLING_TEST=false is set for
 * launch. Development stores can only ever accept test charges.
 */
export const billingIsTest = () => process.env.SHOPIFY_BILLING_TEST !== "false";

const ACTIVE_SUBSCRIPTIONS = `#graphql
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions { id name status test currentPeriodEnd trialDays }
    }
  }`;

export interface ActiveSubscription {
  id: string;
  name: string;
  status: string;
  test: boolean;
  currentPeriodEnd: string | null;
  trialDays: number;
}

/**
 * Shopify is the source of truth for what a shop pays for. Read its active
 * subscription and write the matching plan to Shop.plan (FREE if none).
 * Test subscriptions only count while billing is in test mode, so a
 * leftover test charge can't unlock a paid plan after launch.
 */
export async function syncPlan(
  admin: GraphqlClient,
  shop: string,
): Promise<{ plan: PlanId; subscription: ActiveSubscription | null }> {
  const res = await admin.graphql(ACTIVE_SUBSCRIPTIONS);
  const json = (await res.json()) as {
    data?: { currentAppInstallation: { activeSubscriptions: ActiveSubscription[] } };
  };
  const subs = json.data?.currentAppInstallation.activeSubscriptions ?? [];
  const testOk = billingIsTest();
  const subscription =
    subs.find((s) => s.status === "ACTIVE" && (testOk || !s.test) && planFromBillingName(s.name)) ??
    null;
  const plan: PlanId = subscription ? planFromBillingName(subscription.name)! : "FREE";
  await prisma.shop.update({ where: { shop }, data: { plan: plan as Plan } });
  return { plan, subscription };
}
