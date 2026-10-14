// Pure parts of the usage alerts (testable without Shopify).

export type UsageLevel = 0 | 80 | 100;

export function usageLevel(used: number, limit: number): UsageLevel {
  if (used >= limit) return 100;
  if (used * 100 >= limit * 80) return 80;
  return 0;
}

export function plansUrl(shop: string): string {
  const store = shop.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${store}/apps/${process.env.SHOPIFY_API_KEY}/app/plans`;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function usageEmail(
  level: 80 | 100,
  o: { shopName: string; planName: string; used: number; limit: number; resetsAt: string; url: string; canUpgrade: boolean },
): { subject: string; text: string } {
  const upgrade = o.canUpgrade
    ? `Upgrade your plan to keep weather on every slip:\n${o.url}`
    : `See your usage:\n${o.url}`;
  if (level === 100) {
    return {
      subject: "Weather Slip: you've reached this month's print limit",
      text: `Hi ${o.shopName},\n\nYou've used all ${o.limit.toLocaleString("en-US")} prints with weather included in your ${o.planName} plan this month. Slips, reprints included, print without weather until your allowance resets on ${fmtDate(o.resetsAt)}.\n\n${upgrade}\n\n— Weather Slip`,
    };
  }
  return {
    subject: "Weather Slip: you've used 80% of this month's prints",
    text: `Hi ${o.shopName},\n\nYou've used ${o.used.toLocaleString("en-US")} of the ${o.limit.toLocaleString("en-US")} prints with weather included in your ${o.planName} plan this month. Your allowance resets on ${fmtDate(o.resetsAt)}. Once it runs out, new slips print without weather until then.\n\n${upgrade}\n\n— Weather Slip`,
  };
}
