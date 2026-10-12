import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

// Mandatory GDPR topics. What we hold per order: city, country code, a
// rounded (~11 km) coordinate and the weather — no name, street, email or
// phone. The shared WeatherCache is keyed by grid cell only and isn't
// linked to any order or customer.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      // Nothing is keyed by customer; the merchant can see per-order data in
      // the order's weather_slip metafields. Logged for the audit trail.
      const ids = (payload as { orders_requested?: number[] }).orders_requested ?? [];
      console.log(`[gdpr] data_request for ${shop}: ${ids.length} order(s)`);
      break;
    }
    case "CUSTOMERS_REDACT": {
      const ids = ((payload as { orders_to_redact?: number[] }).orders_to_redact ?? []).map(String);
      if (ids.length) {
        await prisma.orderWeatherSnapshot.deleteMany({ where: { shop, orderId: { in: ids } } });
        await prisma.weatherJob.deleteMany({ where: { shop, orderId: { in: ids } } });
      }
      break;
    }
    case "SHOP_REDACT": {
      // Cascades to snapshots and jobs.
      await prisma.shop.deleteMany({ where: { shop } });
      await prisma.session.deleteMany({ where: { shop } });
      break;
    }
  }
  return new Response();
};
