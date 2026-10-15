import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { PLANS, templatePlan } from "../lib/plans";
import { SLIP_TEMPLATES } from "../lib/slip";

// What the shop's plan lets the "Weather slip" print action in Shopify's
// Orders section offer (extensions/weather-slip-print*), so it can disable
// locked templates instead of listing all four. /print/admin enforces the
// same gates; this is only for the menu.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, cors } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shop: session.shop }, select: { plan: true } });
  const plan = PLANS[shop?.plan ?? "FREE"];
  return cors(
    Response.json({
      plan: plan.name,
      customerList: plan.customerList,
      templates: SLIP_TEMPLATES.map((t) => ({
        id: t.id,
        allowed: plan.templates.includes(t.id),
        plan: PLANS[templatePlan(t.id)].name,
      })),
    }),
  );
};
