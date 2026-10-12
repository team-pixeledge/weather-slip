import { timingSafeEqual } from "node:crypto";
import type { LoaderFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";

// Operator diagnostic: is Shopify sharing protected customer fields with
// the app for this shop? Reports only whether each field came back —
// never the values. Guarded by CRON_SECRET like /api/cron/drain.
const PROBE = `#graphql
  query WeatherSlipProtectedDataProbe {
    orders(first: 5, sortKey: CREATED_AT, reverse: true) {
      nodes {
        name
        email
        phone
        shippingAddress { name address1 city phone latitude }
        billingAddress { name }
      }
    }
  }`;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

const present = (v: unknown) => (v == null || v === "" ? "empty" : "yes");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const shop = new URL(request.url).searchParams.get("shop") ?? "";
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) return new Response("Bad shop", { status: 400 });

  const { admin } = await unauthenticated.admin(shop);
  let data: { orders?: { nodes: Record<string, unknown>[] } } | undefined;
  let errors: string[] = [];
  try {
    const res = await admin.graphql(PROBE);
    data = ((await res.json()) as { data?: typeof data }).data;
  } catch (err) {
    const body = (err as { body?: { data?: typeof data; errors?: { graphQLErrors?: { message: string }[] } } }).body;
    data = body?.data ?? undefined;
    errors = (body?.errors?.graphQLErrors ?? []).map((e) => e.message);
    if (!errors.length) errors = [err instanceof Error ? err.message : String(err)];
  }
  const orders = (data?.orders?.nodes ?? []).map((o) => {
    const s = (o.shippingAddress ?? {}) as Record<string, unknown>;
    const b = (o.billingAddress ?? {}) as Record<string, unknown>;
    return {
      order: o.name,
      email: present(o.email),
      phone: present(o.phone),
      shipName: present(s.name),
      shipAddress1: present(s.address1),
      shipCity: present(s.city),
      shipPhone: present(s.phone),
      shipLatitude: present(s.latitude),
      billName: present(b.name),
    };
  });
  return Response.json({ shop, orders, errors: [...new Set(errors)] });
};
