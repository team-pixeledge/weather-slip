import type { LoaderFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import { verifyPrintToken } from "../lib/print-token.server";

// Operator diagnostic: is Shopify sharing protected customer fields with
// the app for this shop? Reports only whether each field came back —
// never the values. Authorised by a signed print token (?t=, same as the
// print pages): the shop comes from the token.
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

const present = (v: unknown) => (v == null || v === "" ? "empty" : "yes");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = verifyPrintToken(new URL(request.url).searchParams.get("t"));
  if (!shop) return new Response("Unauthorized", { status: 401 });

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
