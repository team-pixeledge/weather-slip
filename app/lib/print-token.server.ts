import { createHmac, timingSafeEqual } from "node:crypto";

// Printing opens a plain browser tab (no App Bridge, so no session token in
// it). The embedded page hands that tab a short-lived signed token instead:
// it proves the bearer was signed in to this shop's admin a moment ago. The
// token carries the shop only — order IDs go in the URL, and every order is
// fetched with that shop's own access token, so a token can never reach
// another shop's orders.
export const PRINT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

interface PrintClaims {
  shop: string;
  exp: number; // epoch ms
}

function secret(): string {
  const s = process.env.SHOPIFY_API_SECRET;
  if (!s) throw new Error("SHOPIFY_API_SECRET is not set");
  return s;
}

const sign = (body: string) =>
  createHmac("sha256", secret()).update(`print:${body}`).digest("base64url");

export function signPrintToken(shop: string, now = Date.now()): string {
  const claims: PrintClaims = { shop, exp: now + PRINT_TOKEN_TTL_MS };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** The shop the token was issued for, or null if it's forged or expired. */
export function verifyPrintToken(token: string | null, now = Date.now()): string | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as PrintClaims;
    if (typeof claims.shop !== "string" || typeof claims.exp !== "number") return null;
    return claims.exp > now ? claims.shop : null;
  } catch {
    return null;
  }
}
