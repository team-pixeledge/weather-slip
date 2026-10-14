import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { notifyAdmin } from "../lib/alerts.server";
import {
  METAFIELD_FORECAST_KEY,
  METAFIELD_NAMESPACE,
  METAFIELD_SNAPSHOT_KEY,
  METAFIELD_SUMMARY_KEY,
} from "../lib/constants";
import { authenticate, unauthenticated } from "../shopify.server";

// Mandatory GDPR topics. What we hold per order: city, country code, a
// rounded (~11 km) coordinate and the weather — no name, street, email or
// phone. The same weather sits on the order itself as weather_slip
// metafields. The shared WeatherCache is keyed by grid cell only and isn't
// linked to any order or customer.

const METAFIELDS_DELETE = `#graphql
  mutation RedactWeather($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) { userErrors { message } }
  }`;

/**
 * Remove our weather metafields from redacted orders. Best effort: after an
 * uninstall there's no session, and shop/redact clears our side anyway.
 */
async function deleteOrderMetafields(shop: string, orderIds: string[]) {
  let admin;
  try {
    ({ admin } = await unauthenticated.admin(shop));
  } catch {
    return; // no offline session (uninstalled)
  }
  const keys = [METAFIELD_SUMMARY_KEY, METAFIELD_SNAPSHOT_KEY, METAFIELD_FORECAST_KEY];
  const all = orderIds.flatMap((id) =>
    keys.map((key) => ({ ownerId: `gid://shopify/Order/${id}`, namespace: METAFIELD_NAMESPACE, key })),
  );
  for (let i = 0; i < all.length; i += 25) {
    try {
      const res = await admin.graphql(METAFIELDS_DELETE, { variables: { metafields: all.slice(i, i + 25) } });
      const json = (await res.json()) as {
        data?: { metafieldsDelete: { userErrors: { message: string }[] } };
      };
      const errs = json.data?.metafieldsDelete.userErrors ?? [];
      if (errs.length) console.warn("[gdpr] metafieldsDelete:", errs.map((e) => e.message).join("; "));
    } catch (err) {
      console.warn("[gdpr] metafieldsDelete failed:", err instanceof Error ? err.message : err);
    }
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      // Nothing is keyed by customer, only by order. Email the operator what
      // we hold for the requested orders so it can be sent to the merchant
      // (Shopify expects the app to supply it within 30 days).
      const p = payload as { orders_requested?: number[]; data_request?: { id?: number } };
      const ids = (p.orders_requested ?? []).map(String);
      const rows = ids.length
        ? await prisma.orderWeatherSnapshot.findMany({
            where: { shop, orderId: { in: ids } },
            select: {
              orderName: true, version: true, city: true, countryCode: true,
              dispatchDate: true, deliveryDate: true, summary: true, createdAt: true,
            },
            orderBy: [{ orderName: "asc" }, { version: "asc" }],
          })
        : [];
      const held = rows.length
        ? rows
            .map((r) => `${r.orderName} v${r.version} (${r.createdAt.toISOString()}): ${[r.city, r.countryCode].filter(Boolean).join(", ")}; dispatch ${r.dispatchDate ?? "-"}, delivery ${r.deliveryDate ?? "-"}; ${r.summary ?? ""}`)
            .join("\n")
        : "No weather data held for these orders.";
      console.log(`[gdpr] data_request for ${shop}: ${ids.length} order(s), ${rows.length} snapshot row(s)`);
      await notifyAdmin(
        `gdpr-data-request:${shop}:${p.data_request?.id ?? ids.join(",")}`,
        "GDPR customer data request — reply to the merchant within 30 days",
        `Shop: ${shop}\nData request: ${p.data_request?.id ?? "n/a"}\nOrders: ${ids.join(", ") || "none"}\n\nWhat Weather Slip holds (no name, street, email or phone is stored):\n${held}`,
      );
      break;
    }
    case "CUSTOMERS_REDACT": {
      const ids = ((payload as { orders_to_redact?: number[] }).orders_to_redact ?? []).map(String);
      if (ids.length) {
        await prisma.orderWeatherSnapshot.deleteMany({ where: { shop, orderId: { in: ids } } });
        await prisma.weatherJob.deleteMany({ where: { shop, orderId: { in: ids } } });
        await prisma.printedOrder.deleteMany({ where: { shop, orderId: { in: ids } } });
        await deleteOrderMetafields(shop, ids);
      }
      break;
    }
    case "SHOP_REDACT": {
      // Cascades to snapshots, jobs, counted orders and template requests.
      await prisma.shop.deleteMany({ where: { shop } });
      await prisma.session.deleteMany({ where: { shop } });
      break;
    }
  }
  return new Response();
};
