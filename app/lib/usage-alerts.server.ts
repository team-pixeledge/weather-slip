import prisma from "../db.server";
import { sendMerchantEmail } from "./alerts.server";
import { PLANS } from "./plans";
import { usageSummary } from "./shop.server";
import { plansUrl, usageEmail, usageLevel } from "./usage-alerts";
import { unauthenticated } from "../shopify.server";
import { captureError } from "./sentry.server";

// Email the shop owner when they reach 80% and then 100% of the month's
// orders. Each level goes out once per usage period; the level resets with
// the period (consumeUsage) and on a plan change (syncPlan).

async function ownerEmail(shop: string): Promise<{ email: string; name: string } | null> {
  const { admin } = await unauthenticated.admin(shop);
  const res = await admin.graphql(`#graphql
    query ShopOwnerEmail { shop { name email } }`);
  const json = (await res.json()) as { data?: { shop: { name: string; email: string | null } } };
  const s = json.data?.shop;
  return s?.email ? { email: s.email, name: s.name } : null;
}

/** Called after an order is counted. Never throws. */
export async function notifyUsageIfNeeded(shopDomain: string): Promise<void> {
  try {
    const shop = await prisma.shop.findUnique({ where: { shop: shopDomain } });
    if (!shop || shop.uninstalledAt) return;
    const u = usageSummary(shop);
    const level = usageLevel(u.used, u.limit);
    if (level === 0 || level <= shop.usageAlertLevel) return;
    // Claim the level first so concurrent counts send one email, not two.
    const { count } = await prisma.shop.updateMany({
      where: {
        shop: shopDomain,
        plan: shop.plan,
        usagePeriodStart: shop.usagePeriodStart,
        usageAlertLevel: { lt: level },
      },
      data: { usageAlertLevel: level },
    });
    if (count !== 1) return;
    const owner = await ownerEmail(shopDomain);
    if (!owner) {
      console.error(`[usage-alert] ${shopDomain}: no shop email to send the ${level}% alert to`);
      return;
    }
    const { subject, text } = usageEmail(level, {
      shopName: owner.name,
      planName: PLANS[shop.plan].name,
      used: u.used,
      limit: u.limit,
      resetsAt: u.resetsAt,
      url: plansUrl(shopDomain),
      canUpgrade: shop.plan !== "BUSINESS",
    });
    await sendMerchantEmail(owner.email, subject, text);
  } catch (err) {
    console.error("[usage-alert]", err instanceof Error ? err.message : err);
    captureError(err, { where: "usage-alert-email", shop: shopDomain });
  }
}
