import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { billingIsTest, syncPlan } from "../lib/billing.server";
import {
  billingName,
  PAID_PLANS,
  PLAN_ORDER,
  PLANS,
  planFeatures,
  USAGE_PERIOD_DAYS,
  type PlanId,
} from "../lib/plans";
import { ensureShop } from "../lib/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  // Re-read from Shopify on every visit: this is where a merchant lands
  // after approving or declining a charge.
  const { plan, subscription } = await syncPlan(admin, session.shop);

  const now = Date.now();
  const periodMs = USAGE_PERIOD_DAYS * 86_400_000;
  const elapsed = now - shop.usagePeriodStart.getTime() >= periodMs;
  const resetsAt = elapsed
    ? new Date(now + periodMs)
    : new Date(shop.usagePeriodStart.getTime() + periodMs);

  return {
    current: plan,
    used: elapsed ? 0 : shop.usageCount,
    limit: PLANS[plan].ordersPerPeriod,
    resetsAt: resetsAt.toISOString(),
    subscription,
    testMode: billingIsTest(),
    plans: PLAN_ORDER.map((id) => ({ id, ...PLANS[id], features: planFeatures(id) })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const form = await request.formData();
  const target = String(form.get("plan")) as PlanId;
  const isTest = billingIsTest();

  if (PAID_PLANS.includes(target)) {
    // Shopify's own approval screen; it sends the merchant back here.
    const store = session.shop.replace(/\.myshopify\.com$/, "");
    const returnUrl = `https://admin.shopify.com/store/${store}/apps/${process.env.SHOPIFY_API_KEY}/app/plans`;
    // Throws the redirect out of the iframe to the confirmation page.
    await billing.request({ plan: billingName(target), isTest, returnUrl });
    return { ok: false };
  }

  if (target === "FREE") {
    const { subscription } = await syncPlan(admin, session.shop);
    if (subscription) {
      await billing.cancel({ subscriptionId: subscription.id, isTest, prorate: true });
    }
    await syncPlan(admin, session.shop);
    return { ok: true, plan: "FREE" as const };
  }
  return { ok: false };
};

const money = (n: number) =>
  n === 0 ? "Free" : `$${n.toFixed(2)}`;

export default function Plans() {
  const { current, used, limit, resetsAt, subscription, testMode, plans } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busyPlan = fetcher.state !== "idle" ? String(fetcher.formData?.get("plan")) : null;

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.plan === "FREE") {
      shopify.toast.show("You're on the Free plan");
    }
  }, [fetcher.data, shopify]);

  const choose = (plan: PlanId) => fetcher.submit({ plan }, { method: "POST" });
  const rank = (id: PlanId) => PLAN_ORDER.indexOf(id);
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const resets = new Date(resetsAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });

  return (
    <s-page heading="Plans & pricing">
      {testMode && (
        <s-banner tone="info">
          Billing is in test mode: plan changes go through Shopify&apos;s
          approval screen, but no money is charged.
        </s-banner>
      )}

      <s-section heading="This month">
        <s-stack direction="block" gap="small-200">
          <s-text>
            <strong>{PLANS[current].name}</strong> plan · {used.toLocaleString()} of{" "}
            {limit.toLocaleString()} orders printed with weather · resets {resets}
          </s-text>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{ height: 8, borderRadius: 4, background: "#e3e3e3", overflow: "hidden" }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: pct >= 100 ? "#c70a24" : pct >= 80 ? "#b28500" : "#1f6fdb",
              }}
            />
          </div>
          {pct >= 100 ? (
            <s-text tone="critical">
              Limit reached — new slips print without weather until {resets}, or upgrade now.
            </s-text>
          ) : pct >= 80 ? (
            <s-text tone="caution">You&apos;ve used {pct}% of this month&apos;s orders.</s-text>
          ) : null}
          {subscription && (
            <s-text color="subdued">
              Billed by Shopify on your store invoice
              {subscription.currentPeriodEnd
                ? ` · renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
                : ""}
              {subscription.test ? " · test charge" : ""}
            </s-text>
          )}
        </s-stack>
      </s-section>

      <s-grid gridTemplateColumns="@container (inline-size > 700px) 1fr 1fr 1fr, 1fr" gap="base">
        {plans.map((p) => {
          const isCurrent = p.id === current;
          const up = rank(p.id) > rank(current);
          return (
            <s-section key={p.id}>
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-heading>{p.name}</s-heading>
                  {isCurrent && <s-badge tone="success">Current plan</s-badge>}
                  {p.id === "STARTER" && !isCurrent && <s-badge tone="info">Popular</s-badge>}
                </s-stack>
                <s-text>
                  <span style={{ fontSize: 28, fontWeight: 650 }}>{money(p.priceUsd)}</span>
                  {p.priceUsd > 0 ? " / month" : ""}
                </s-text>
                <s-text color="subdued">{p.tagline}</s-text>
                <s-unordered-list>
                  {p.features.map((f) => (
                    <s-list-item key={f}>{f}</s-list-item>
                  ))}
                </s-unordered-list>
                {isCurrent ? (
                  <s-button disabled>Current plan</s-button>
                ) : p.id === "FREE" ? (
                  <s-button commandFor="downgrade-free" command="--show">
                    Switch to Free
                  </s-button>
                ) : (
                  <s-button
                    variant={up ? "primary" : "secondary"}
                    onClick={() => choose(p.id)}
                    {...(busyPlan === p.id ? { loading: true } : {})}
                  >
                    {up ? `Upgrade to ${p.name}` : `Switch to ${p.name}`}
                  </s-button>
                )}
              </s-stack>
            </s-section>
          );
        })}
      </s-grid>

      <s-modal id="downgrade-free" heading="Switch to the Free plan?">
        <s-paragraph>
          Your {PLANS[current].name} subscription is cancelled now, with any
          unused time credited by Shopify. You&apos;ll have{" "}
          {PLANS.FREE.ordersPerPeriod} orders a month printed with weather.
          Orders that already have weather keep it.
        </s-paragraph>
        <s-button
          slot="primary-action"
          tone="critical"
          commandFor="downgrade-free"
          command="--hide"
          onClick={() => choose("FREE")}
        >
          Switch to Free
        </s-button>
        <s-button slot="secondary-actions" commandFor="downgrade-free" command="--hide">
          Keep {PLANS[current].name}
        </s-button>
      </s-modal>

      <s-section slot="aside" heading="How plans work">
        <s-paragraph>
          Plans count orders, not weather lookups. An order counts once, the
          first time its packing slip is printed with weather. Reprints are
          always free, and orders you never print never count.
        </s-paragraph>
        <s-paragraph>
          The count resets every {USAGE_PERIOD_DAYS} days. At the limit, slips
          still print — just without the weather — until it resets or you
          upgrade.
        </s-paragraph>
        <s-paragraph>
          Charges appear on your Shopify invoice. Upgrades take effect straight
          away; you can switch or cancel any time.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
