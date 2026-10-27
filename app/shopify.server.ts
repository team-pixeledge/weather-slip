import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { ensureShop } from "./lib/shop.server";
import { syncPlan } from "./lib/billing.server";
import { captureError } from "./lib/sentry.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      const res = await admin.graphql(`#graphql
        query ShopTimezone { shop { ianaTimezone } }`);
      const json = (await res.json()) as { data?: { shop: { ianaTimezone: string } } };
      await ensureShop(session.shop, json.data?.shop.ianaTimezone);
      // A reinstall must not keep the plan from before the uninstall —
      // Shopify cancelled that charge. Read what the shop actually pays for
      // now (FREE after a reinstall). Best-effort: never block the install.
      try {
        await syncPlan(admin, session.shop);
      } catch (err) {
        captureError(err, { where: "afterAuth syncPlan", shop: session.shop });
      }
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
// shopify-api's sanitizeHost base64-decodes `host` and calls `new URL()` on it
// without a try/catch: a value that passes its base64 regex but decodes to
// junk (App Review's probe sends `host=9998818203999999999`) throws a TypeError
// and the request 500s. Reject it as a 400 before the library sees it.
function assertParsableHost(request: Request) {
  const host = new URL(request.url).searchParams.get("host");
  // Same regex/decode/parse steps as sanitizeHost; anything else it rejects
  // cleanly (App Bridge bounce), so only the parse can blow up.
  if (!host || !/^[0-9a-zA-Z+/]+={0,2}$/.test(host)) return;
  try {
    new URL(`https://${atob(host)}`);
  } catch {
    throw new Response("Invalid host parameter", { status: 400 });
  }
}

export const authenticate = {
  ...shopify.authenticate,
  admin: ((request: Request) => {
    assertParsableHost(request);
    return shopify.authenticate.admin(request);
  }) as typeof shopify.authenticate.admin,
};
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
