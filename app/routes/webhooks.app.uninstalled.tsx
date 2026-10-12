import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Keep settings and snapshots until shop/redact (48h later) so a quick
  // reinstall doesn't lose them; stop any queued work now.
  await db.shop.updateMany({ where: { shop }, data: { uninstalledAt: new Date() } });
  await db.weatherJob.deleteMany({ where: { shop, status: { in: ["PENDING", "RUNNING"] } } });

  return new Response();
};
