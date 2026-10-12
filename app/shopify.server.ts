import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { billingName, PAID_PLANS, PLANS } from "./lib/plans";
import { ensureShop } from "./lib/shop.server";

// Billing API plans, keyed by subscription name ("Starter", "Pro"), built
// from PLANS so prices are defined in one place.
const billing = Object.fromEntries(
  PAID_PLANS.map((id) => [
    billingName(id),
    {
      lineItems: [
        {
          amount: PLANS[id].priceUsd,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days as const,
        },
      ],
    },
  ]),
);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      const res = await admin.graphql(`#graphql
        query ShopTimezone { shop { ianaTimezone } }`);
      const json = (await res.json()) as { data?: { shop: { ianaTimezone: string } } };
      await ensureShop(session.shop, json.data?.shop.ianaTimezone);
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
