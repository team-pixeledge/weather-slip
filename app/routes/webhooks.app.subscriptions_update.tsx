import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { syncPlan } from "../lib/billing.server";

// app_subscriptions/update: a charge was approved, cancelled, declined,
// frozen or expired — possibly from Shopify's side (e.g. unpaid invoice), not
// our Plans page. Rather than trust the payload's status, re-read the shop's
// active subscriptions; the same code path the Plans page uses.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin } = await authenticate.webhook(request);
  const known = await prisma.shop.findUnique({ where: { shop }, select: { uninstalledAt: true } });
  if (admin && known && !known.uninstalledAt) {
    await syncPlan(admin, shop);
  }
  return new Response();
};
