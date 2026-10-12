import type { Shop } from "@prisma/client";
import prisma from "../db.server";
import { decrypt, encrypt } from "./crypto.server";
import type { GraphqlClient } from "./orders.server";
import { query } from "./orders.server";
import { isShopifyCdnUrl } from "./slip";

// The store logo, found automatically:
// 1. Shopify → Settings → Brand. The Admin API doesn't expose it; the
//    Storefront API does (Shop.brand), so the app creates its own
//    Storefront access token once (needs unauthenticated_read_content) and
//    keeps it encrypted. Works on password-protected stores, where
//    tokenless Storefront calls are refused.
// 2. Most stores set their logo in the theme editor instead, so if Brand
//    has none: the live theme's settings_data.json (read_themes) gives
//    "shopify://shop_images/<file>", resolved to its CDN URL via the Files
//    API (read_files).

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

async function storefrontToken(
  admin: GraphqlClient,
  shop: Shop,
): Promise<string> {
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
  const token =
    data.storefrontAccessTokenCreate.storefrontAccessToken?.accessToken;
  if (!token) {
    throw new Error(
      data.storefrontAccessTokenCreate.userErrors
        .map((e) => e.message)
        .join("; ") || "Couldn't create a Storefront token",
    );
  }
  await prisma.shop.update({
    where: { shop: shop.shop },
    data: { storefrontTokenEnc: encrypt(token) },
  });
  return token;
}

async function fetchBrandLogo(
  shopDomain: string,
  token: string,
): Promise<string | null> {
  const res = await fetch(
    `https://${shopDomain}/api/${STOREFRONT_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Shopify-Storefront-Access-Token": token,
      },
      body: JSON.stringify({ query: BRAND }),
      signal: AbortSignal.timeout(8_000),
    },
  );
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

const THEME_SETTINGS = `#graphql
  query WeatherSlipThemeLogo {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        files(filenames: ["config/settings_data.json"], first: 1) {
          nodes { body { ... on OnlineStoreThemeFileBodyText { content } } }
        }
      }
    }
  }`;

const FILE_URL = `#graphql
  query WeatherSlipFileUrl($q: String!) {
    files(first: 1, query: $q) {
      nodes {
        ... on MediaImage { image { url } }
        ... on GenericFile { url }
      }
    }
  }`;

/** First "shopify://shop_images/…" under a logo-ish key, preferring "logo". */
export function findThemeLogoRef(settingsJson: string): string | null {
  // Shopify prefixes theme JSON files with a /* … */ comment.
  const text = settingsJson.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const root = data as { current?: unknown; presets?: Record<string, unknown> };
  // "current" can be the name of a preset rather than the settings object.
  const current =
    typeof root.current === "string"
      ? root.presets?.[root.current]
      : root.current;
  const hits: { key: string; ref: string }[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (
        typeof v === "string" &&
        /logo/i.test(k) &&
        v.startsWith("shopify://shop_images/")
      ) {
        hits.push({ key: k, ref: v });
      } else if (v && typeof v === "object") {
        walk(v);
      }
    }
  };
  walk(current);
  const best =
    hits.find((h) => h.key === "logo") ??
    hits.find((h) => !/mobile|footer|favicon/i.test(h.key)) ??
    hits[0];
  return best?.ref ?? null;
}

async function themeLogo(admin: GraphqlClient): Promise<string | null> {
  const data = await query<{
    themes: { nodes: { files: { nodes: { body: { content?: string } }[] } }[] };
  }>(admin, THEME_SETTINGS, {});
  const content = data.themes.nodes[0]?.files.nodes[0]?.body.content;
  const ref = content ? findThemeLogoRef(content) : null;
  if (!ref) return null;
  const filename = decodeURIComponent(
    ref.slice("shopify://shop_images/".length),
  ).replace(/'/g, "");
  const files = await query<{
    files: { nodes: { image?: { url: string }; url?: string }[] };
  }>(admin, FILE_URL, { q: `filename:'${filename}'` });
  const node = files.files.nodes[0];
  const url = node?.image?.url ?? node?.url ?? null;
  return url && isShopifyCdnUrl(url) ? url : null;
}
class TokenRejected extends Error {}

/**
 * Re-read the store logo and cache it on the Shop row. Never throws: a
 * failure (e.g. the merchant hasn't approved the new scope yet) keeps the
 * last known logo.
 */
export async function refreshBrandLogo(
  admin: GraphqlClient,
  shop: Shop,
): Promise<string | null> {
  try {
    let token = await storefrontToken(admin, shop);
    let url: string | null;
    try {
      url = await fetchBrandLogo(shop.shop, token);
    } catch (err) {
      if (!(err instanceof TokenRejected)) throw err;
      // Token revoked (e.g. reinstall): make a fresh one and retry once.
      token = await storefrontToken(admin, {
        ...shop,
        storefrontTokenEnc: null,
      });
      url = await fetchBrandLogo(shop.shop, token);
    }
    if (!url) {
      url = await themeLogo(admin).catch((err) => {
        console.warn(
          "[brand-logo] theme lookup:",
          shop.shop,
          err instanceof Error ? err.message : err,
        );
        return null;
      });
    }
    if (!url)
      console.info(
        "[brand-logo] no logo in Settings → Brand or the live theme:",
        shop.shop,
      );
    await prisma.shop.update({
      where: { shop: shop.shop },
      data: { brandLogoUrl: url, brandLogoCheckedAt: new Date() },
    });
    return url;
  } catch (err) {
    console.warn(
      "[brand-logo]",
      shop.shop,
      err instanceof Error ? err.message : err,
    );
    return shop.brandLogoUrl;
  }
}

/** Refresh only if the cached logo is more than a day old (used when printing). */
export function brandLogoIfFresh(
  admin: GraphqlClient,
  shop: Shop,
): Promise<string | null> {
  const stale =
    !shop.brandLogoCheckedAt ||
    Date.now() - shop.brandLogoCheckedAt.getTime() > RECHECK_MS;
  return stale
    ? refreshBrandLogo(admin, shop)
    : Promise.resolve(shop.brandLogoUrl);
}
