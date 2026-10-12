import type { Shop } from "@prisma/client";
import prisma from "../db.server";
import { decrypt, encrypt } from "./crypto.server";
import type { GraphqlClient } from "./orders.server";
import { query } from "./orders.server";
import { isShopifyCdnUrl } from "./slip";

// The store logo from Shopify → Settings → Brand. The Admin API doesn't
// expose it; the Storefront API does (Shop.brand), so the app creates its
// own Storefront access token once (needs one unauthenticated_* scope —
// unauthenticated_read_content) and keeps it encrypted. Works on
// password-protected stores, where tokenless Storefront calls are refused.

const STOREFRONT_VERSION = "2026-10";
const RECHECK_MS = 24 * 60 * 60 * 1000;

const CREATE_TOKEN = `#graphql
  mutation WeatherSlipStorefrontToken($input: StorefrontAccessTokenInput!) {
    storefrontAccessTokenCreate(input: $input) {
      storefrontAccessToken { accessToken }
      userErrors { field message }
    }
  }`;

const BRAND = `{ shop { brand { logo { image { url } } squareLogo { image { url } } } } }`;

async function storefrontToken(admin: GraphqlClient, shop: Shop): Promise<string> {
  if (shop.storefrontTokenEnc) {
    try {
      return decrypt(shop.storefrontTokenEnc);
    } catch {
      // ENCRYPTION_KEY rotated — make a new token below.
    }
  }
  const data = await query<{
    storefrontAccessTokenCreate: {
      storefrontAccessToken: { accessToken: string } | null;
      userErrors: { message: string }[];
    };
  }>(admin, CREATE_TOKEN, { input: { title: "Weather Slip (store logo)" } });
  const token = data.storefrontAccessTokenCreate.storefrontAccessToken?.accessToken;
  if (!token) {
    throw new Error(
      data.storefrontAccessTokenCreate.userErrors.map((e) => e.message).join("; ") ||
        "Couldn't create a Storefront token",
    );
  }
  await prisma.shop.update({ where: { shop: shop.shop }, data: { storefrontTokenEnc: encrypt(token) } });
  return token;
}

async function fetchBrandLogo(shopDomain: string, token: string): Promise<string | null> {
  const res = await fetch(`https://${shopDomain}/api/${STOREFRONT_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Shopify-Storefront-Access-Token": token },
    body: JSON.stringify({ query: BRAND }),
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 401 || res.status === 403) throw new TokenRejected();
  const json = (await res.json()) as {
    data?: { shop: { brand: { logo?: Logo; squareLogo?: Logo } | null } };
  };
  const brand = json.data?.shop.brand;
  const url = brand?.logo?.image?.url ?? brand?.squareLogo?.image?.url ?? null;
  // Only Shopify-hosted images: the print page's CSP allows nothing else.
  return url && isShopifyCdnUrl(url) ? url : null;
}

type Logo = { image: { url: string } | null } | null;
class TokenRejected extends Error {}

/**
 * Re-read the store logo and cache it on the Shop row. Never throws: a
 * failure (e.g. the merchant hasn't approved the new scope yet) keeps the
 * last known logo.
 */
export async function refreshBrandLogo(admin: GraphqlClient, shop: Shop): Promise<string | null> {
  try {
    let token = await storefrontToken(admin, shop);
    let url: string | null;
    try {
      url = await fetchBrandLogo(shop.shop, token);
    } catch (err) {
      if (!(err instanceof TokenRejected)) throw err;
      // Token revoked (e.g. reinstall): make a fresh one and retry once.
      token = await storefrontToken(admin, { ...shop, storefrontTokenEnc: null });
      url = await fetchBrandLogo(shop.shop, token);
    }
    await prisma.shop.update({
      where: { shop: shop.shop },
      data: { brandLogoUrl: url, brandLogoCheckedAt: new Date() },
    });
    return url;
  } catch (err) {
    console.warn("[brand-logo]", shop.shop, err instanceof Error ? err.message : err);
    return shop.brandLogoUrl;
  }
}

/** Refresh only if the cached logo is more than a day old (used when printing). */
export function brandLogoIfFresh(admin: GraphqlClient, shop: Shop): Promise<string | null> {
  const stale =
    !shop.brandLogoCheckedAt || Date.now() - shop.brandLogoCheckedAt.getTime() > RECHECK_MS;
  return stale ? refreshBrandLogo(admin, shop) : Promise.resolve(shop.brandLogoUrl);
}
