import type { Plan } from "@prisma/client";
import prisma from "../db.server";
import type { GraphqlClient } from "./orders.server";
import { billingName, planFromBillingName, PLANS, type PlanId } from "./plans";

// Shopify Billing API, called directly (not the library's billing.request,
// which always answers with a redirect and so hides Shopify's userErrors).
// Pattern from store-performance-monitor's billing/subscribe.

/**
 * Test charges (no money moves) while SHOPIFY_BILLING_TEST isn't "false".
 * Development stores — including the ones Shopify's app reviewers use — can
 * only take test charges, so they always get one regardless.
 */
export const billingIsTest = () => process.env.SHOPIFY_BILLING_TEST !== "false";

async function gql<T>(admin: GraphqlClient, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (!json.data) throw new Error(`Billing query failed: ${JSON.stringify(json.errors)}`);
  return json.data;
}

const BILLING_STATE = `#graphql
  query BillingState {
    shop { plan { partnerDevelopment } }
    currentAppInstallation {
      activeSubscriptions { id name status test currentPeriodEnd createdAt }
    }
  }`;

export interface ActiveSubscription {
  id: string;
  name: string;
  status: string;
  test: boolean;
  currentPeriodEnd: string | null;
  createdAt: string;
}

export interface BillingState {
  plan: PlanId;
  subscription: ActiveSubscription | null;
  devStore: boolean;
  /** Whether a new charge for this shop would be a test charge. */
  testCharge: boolean;
}

/**
 * Shopify is the source of truth for what a shop pays for: read its active
 * subscription and write the matching plan to Shop.plan (FREE if none).
 * A test subscription only counts in test mode or on a development store,
 * so a leftover test charge can't unlock a paid plan on a live store.
 */
export async function syncPlan(admin: GraphqlClient, shop: string): Promise<BillingState> {
  const data = await gql<{
    shop: { plan: { partnerDevelopment: boolean } };
    currentAppInstallation: { activeSubscriptions: ActiveSubscription[] };
  }>(admin, BILLING_STATE);
  const devStore = data.shop.plan.partnerDevelopment;
  const testCharge = billingIsTest() || devStore;
  const subscription =
    data.currentAppInstallation.activeSubscriptions.find(
      (s) => s.status === "ACTIVE" && (testCharge || !s.test) && planFromBillingName(s.name),
    ) ?? null;
  const plan: PlanId = subscription ? planFromBillingName(subscription.name)! : "FREE";
  await prisma.shop.update({ where: { shop }, data: { plan: plan as Plan } });
  return { plan, subscription, devStore, testCharge };
}

const SUBSCRIPTION_CREATE = `#graphql
  mutation WeatherSlipSubscribe(
    $name: String!
    $returnUrl: URL!
    $test: Boolean
    $price: Decimal!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      # Approving a switch ends the old charge and starts the new one right
      # away, for upgrades and downgrades alike (Shopify's STANDARD default
      # defers some downgrades to the end of the cycle).
      replacementBehavior: APPLY_IMMEDIATELY
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: $price, currencyCode: USD }
              interval: EVERY_30_DAYS
            }
          }
        }
      ]
    ) {
      confirmationUrl
      userErrors { field message }
    }
  }`;

/** Start a paid plan; returns Shopify's approval page URL. */
export async function createSubscription(
  admin: GraphqlClient,
  plan: PlanId,
  opts: { returnUrl: string; test: boolean },
): Promise<string> {
  const data = await gql<{
    appSubscriptionCreate: {
      confirmationUrl: string | null;
      userErrors: { message: string }[];
    };
  }>(admin, SUBSCRIPTION_CREATE, {
    name: billingName(plan),
    returnUrl: opts.returnUrl,
    test: opts.test,
    price: PLANS[plan].priceUsd,
  });
  const r = data.appSubscriptionCreate;
  if (!r.confirmationUrl) {
    throw new Error(r.userErrors.map((e) => e.message).join("; ") || "Shopify didn't start the plan change");
  }
  return r.confirmationUrl;
}

const SUBSCRIPTION_CANCEL = `#graphql
  mutation WeatherSlipCancel($id: ID!) {
    appSubscriptionCancel(id: $id, prorate: true) {
      appSubscription { id status }
      userErrors { field message }
    }
  }`;

/** Cancel a paid charge (moving to Free). Throws rather than leave a shop billed. */
export async function cancelSubscription(admin: GraphqlClient, id: string): Promise<void> {
  const data = await gql<{
    appSubscriptionCancel: { appSubscription: { id: string } | null; userErrors: { message: string }[] };
  }>(admin, SUBSCRIPTION_CANCEL, { id });
  const r = data.appSubscriptionCancel;
  if (!r.appSubscription) {
    throw new Error(r.userErrors.map((e) => e.message).join("; ") || "Shopify didn't cancel the plan");
  }
}

const SUBSCRIPTION_STATUS = `#graphql
  query WeatherSlipCharge($id: ID!) {
    node(id: $id) { ... on AppSubscription { id name status } }
  }`;

/**
 * Status of the charge Shopify sent the merchant back from (`charge_id` on
 * the return URL). Only this app's own charges on this shop resolve, so a
 * forged id just reads as null.
 */
export async function chargeStatus(
  admin: GraphqlClient,
  chargeId: string,
): Promise<{ name: string; status: string } | null> {
  if (!/^\d{1,20}$/.test(chargeId)) return null;
  const data = await gql<{ node: { name?: string; status?: string } | null }>(admin, SUBSCRIPTION_STATUS, {
    id: `gid://shopify/AppSubscription/${chargeId}`,
  });
  return data.node?.status ? { name: data.node.name ?? "", status: data.node.status } : null;
}
