import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  cancelSubscription,
  chargeStatus,
  createSubscription,
  syncPlan,
} from "../lib/billing.server";
import {
  comparisonRows,
  PAID_PLANS,
  PLAN_ORDER,
  PLANS,
  planFeatures,
  planFromBillingName,
  USAGE_PERIOD_DAYS,
  type PlanId,
} from "../lib/plans";
import { ensureShop } from "../lib/shop.server";

// Plans & pricing — also the app's usage overview (the old Overview page was
// merged in here). Layout follows store-performance-monitor's select-plan.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const url = new URL(request.url);

  // Shopify sends the merchant back here with ?charge_id= after the
  // approval screen. Read that charge's real status before syncing.
  const chargeId = url.searchParams.get("charge_id");
  const returned = chargeId ? await chargeStatus(admin, chargeId) : null;
  const billing = await syncPlan(admin, session.shop);

  const now = Date.now();
  const periodMs = USAGE_PERIOD_DAYS * 86_400_000;
  const elapsed = now - shop.usagePeriodStart.getTime() >= periodMs;
  const resetsAt = elapsed
    ? now + periodMs
    : shop.usagePeriodStart.getTime() + periodMs;
  const failedJobs = await prisma.weatherJob.count({
    where: { shop: session.shop, status: "FAILED" },
  });

  return {
    current: billing.plan,
    subscription: billing.subscription,
    testCharge: billing.testCharge,
    used: elapsed ? 0 : shop.usageCount,
    resetsAt: new Date(resetsAt).toISOString(),
    failedJobs,
    returned: returned
      ? { status: returned.status, plan: planFromBillingName(returned.name) }
      : chargeId
        ? { status: "UNKNOWN", plan: null }
        : null,
    plans: PLAN_ORDER.map((id) => ({
      id,
      ...PLANS[id],
      features: planFeatures(id),
    })),
    comparison: comparisonRows(),
  };
};

type ActionResult =
  | { ok: true; confirmationUrl: string }
  | { ok: true; switchedTo: PlanId }
  | { ok: false; error: string };

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const target = String(form.get("plan")) as PlanId;
  if (!PLAN_ORDER.includes(target))
    return { ok: false, error: "Unknown plan." };

  try {
    const billing = await syncPlan(admin, session.shop);
    if (billing.plan === target) return { ok: true, switchedTo: target };

    if (target === "FREE") {
      // Cancel first: never mark a shop Free while it's still being billed.
      if (billing.subscription)
        await cancelSubscription(admin, billing.subscription.id);
      await syncPlan(admin, session.shop);
      return { ok: true, switchedTo: "FREE" };
    }

    if (PAID_PLANS.includes(target)) {
      // Back into the embedded app after Shopify's approval screen; Shopify
      // appends charge_id. The current plan stays until the new charge is
      // approved — declining changes nothing.
      const store = session.shop.replace(/\.myshopify\.com$/, "");
      const returnUrl = `https://admin.shopify.com/store/${store}/apps/${process.env.SHOPIFY_API_KEY}/app/plans`;
      const confirmationUrl = await createSubscription(admin, target, {
        returnUrl,
        test: billing.testCharge,
      });
      return { ok: true, confirmationUrl };
    }
  } catch (err) {
    console.error(
      "[plans] plan change failed",
      err instanceof Error ? err.message : err,
    );
    return {
      ok: false,
      error: `We couldn't change your plan: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
  return { ok: false, error: "Unknown plan." };
};

// s-page `subheading` and s-button `inlineSize` are real web-component
// attributes the React typings in @shopify/polaris-types leave out.
const untyped = (props: Record<string, string>) => props as object;
const FILL = untyped({ inlineSize: "fill" });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default function Plans() {
  const d = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [confirmFree, setConfirmFree] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const pending =
    fetcher.state !== "idle" ? String(fetcher.formData?.get("plan")) : null;
  const current = PLANS[d.current];
  const result = fetcher.data;

  useEffect(() => {
    if (!result?.ok) return;
    if ("confirmationUrl" in result) {
      // Shopify's approval screen must be a top-level page, not the iframe.
      window.open(result.confirmationUrl, "_top");
    } else {
      shopify.toast.show(`You're on the ${PLANS[result.switchedTo].name} plan`);
    }
  }, [result, shopify]);

  const choose = (plan: PlanId) => {
    setConfirmFree(false);
    fetcher.submit({ plan }, { method: "POST" });
  };

  const limit = current.ordersPerPeriod;
  const pct = Math.min(100, Math.round((d.used / Math.max(1, limit)) * 100));
  const rank = (id: PlanId) => PLAN_ORDER.indexOf(id);

  return (
    <s-page heading="Plans & pricing">
      {/* One flow container: s-page lays out mixed plain/Polaris children
          unevenly (the cards ran over the comparison box), so everything
          stacks here with explicit gaps. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          paddingBottom: 32,
        }}
      >
        {/* In-page title + subtitle: s-page only puts its heading in the admin
          title bar, and the reference design has it on the page. */}
        <div style={{ margin: "4px 0 4px" }}>
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.3 }}>
            Plan
          </div>
          <s-text color="subdued">
            Start free, or pick a paid plan. Plans count orders printed with
            weather — reprints are free. Change or cancel your plan here
            anytime.
          </s-text>
        </div>

        {/* ---- current plan + usage (was the Overview page) ---- */}
        <s-section>
          <s-stack direction="block" gap="small-300">
            <s-stack
              direction="inline"
              gap="small-200"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-heading>Current plan: {current.name}</s-heading>
              <s-stack direction="inline" gap="small-200">
                <s-badge tone="success">Active</s-badge>
                {d.subscription?.test && (
                  <s-badge tone="info">Test charge</s-badge>
                )}
              </s-stack>
            </s-stack>
            <s-text color="subdued">
              {d.used.toLocaleString()} of {limit.toLocaleString()} orders
              printed with weather this month · resets {fmtDate(d.resetsAt)}
            </s-text>
            <div
              role="progressbar"
              aria-label="Orders used this month"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{
                height: 8,
                borderRadius: 4,
                background: "#e3e3e3",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background:
                    pct >= 100 ? "#c70a24" : pct >= 80 ? "#b28500" : "#1f6fdb",
                }}
              />
            </div>
            {d.subscription?.currentPeriodEnd && (
              <s-text color="subdued">
                Renews {fmtDate(d.subscription.currentPeriodEnd)} · billed on
                your Shopify invoice
              </s-text>
            )}
            {pct >= 100 && (
              <s-text tone="critical">
                Limit reached — new slips print without weather until{" "}
                {fmtDate(d.resetsAt)}. Upgrade to keep weather on every slip.
              </s-text>
            )}
            {pct >= 80 && pct < 100 && (
              <s-text tone="caution">
                You&apos;ve used {pct}% of this month&apos;s orders.
              </s-text>
            )}
            {d.failedJobs > 0 && (
              <s-text tone="caution">
                {d.failedJobs} order(s) couldn&apos;t save weather after several
                retries.
              </s-text>
            )}
            {d.testCharge && (
              <s-text color="subdued">
                Test mode: plan changes go through Shopify&apos;s approval
                screen, but no money is charged.
              </s-text>
            )}
          </s-stack>
        </s-section>

        {/* ---- banners ---- */}
        {d.returned?.status === "ACTIVE" && d.returned.plan && (
          <s-banner
            tone="success"
            heading={`${PLANS[d.returned.plan].name} plan activated`}
          >
            Thanks! Your new plan is active now.
          </s-banner>
        )}
        {d.returned && d.returned.status !== "ACTIVE" && (
          <s-banner tone="warning" heading="Plan not changed">
            The charge wasn&apos;t approved, so you&apos;re still on the{" "}
            {current.name} plan and nothing was billed. Choose a plan below to
            try again.
          </s-banner>
        )}
        {result && !result.ok && (
          <s-banner tone="critical" heading="Something went wrong">
            {result.error}
          </s-banner>
        )}

        {/* ---- plan cards ---- */}
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: -8 }}>
          All plans
        </div>
        {/* Plain CSS grid: one row of cards on desktop, wrapping on narrow
          screens; cards sit on the page background like the App Store. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
            gap: 16,
            alignItems: "stretch",
          }}
        >
          {d.plans.map((p) => {
            const isActive = p.id === d.current;
            const isFree = p.priceUsd === 0;
            const up = rank(p.id) > rank(d.current);
            const confirming = isFree && confirmFree;
            const label = isActive
              ? "Activated"
              : isFree
                ? confirming
                  ? `Yes, cancel ${current.name} and switch`
                  : "Switch to Free"
                : up
                  ? `Upgrade to ${p.name}`
                  : `Downgrade to ${p.name}`;
            return (
              <div
                key={p.id}
                style={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  padding: 16,
                  borderRadius: 12,
                  background: "#fff",
                  boxShadow: isActive
                    ? "0 4px 14px rgba(0,0,0,.10)"
                    : "0 1px 3px rgba(0,0,0,.08)",
                  border: isActive
                    ? "2px solid #29845a"
                    : p.highlight
                      ? "2px solid #1f6fdb"
                      : "1px solid #e3e3e3",
                }}
              >
                <s-stack
                  direction="inline"
                  gap="small-200"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <span style={{ fontSize: 20, fontWeight: 700 }}>
                    {p.name}
                  </span>
                  {isActive ? (
                    <s-badge tone="success">Current plan</s-badge>
                  ) : p.highlight ? (
                    <s-badge tone="info">{p.highlight}</s-badge>
                  ) : null}
                </s-stack>
                <div>
                  <span style={{ fontSize: 30, fontWeight: 700 }}>
                    {isFree ? "$0" : `$${p.priceUsd.toFixed(2)}`}
                  </span>
                  <s-text color="subdued"> / month</s-text>
                  <div>
                    <s-text color="subdued">
                      {isFree
                        ? "Free forever · no card needed"
                        : "Billed every 30 days by Shopify"}
                    </s-text>
                  </div>
                </div>
                <s-text color="subdued">{p.tagline}</s-text>
                <div style={{ borderTop: "1px solid #ebebeb" }} />
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  {p.features.map((f) =>
                    /^Everything in /i.test(f) ? (
                      <div key={f} style={{ marginTop: 4 }}>
                        <s-text color="subdued">{f}</s-text>
                      </div>
                    ) : (
                      <div
                        key={f}
                        style={{
                          display: "flex",
                          gap: 6,
                          alignItems: "flex-start",
                        }}
                      >
                        <span style={{ color: "#29845a", fontWeight: 700 }}>
                          ✓
                        </span>
                        <s-text>{f}</s-text>
                      </div>
                    ),
                  )}
                </div>
                <div style={{ flex: 1 }} />
                {confirming && (
                  <s-text tone="critical">
                    This cancels your {current.name} subscription in Shopify now
                    (unused time is credited). You&apos;ll have{" "}
                    {PLANS.FREE.ordersPerPeriod} orders a month printed with
                    weather.
                  </s-text>
                )}
                <s-button
                  {...FILL}
                  variant={isActive ? "secondary" : "primary"}
                  tone={confirming ? "critical" : undefined}
                  disabled={isActive || (pending !== null && pending !== p.id)}
                  {...(pending === p.id ? { loading: true } : {})}
                  onClick={() => {
                    if (isFree && !confirming) {
                      setConfirmFree(true);
                      return;
                    }
                    choose(p.id);
                  }}
                >
                  {label}
                </s-button>
                {confirming && (
                  <s-button
                    {...FILL}
                    variant="tertiary"
                    onClick={() => setConfirmFree(false)}
                  >
                    Keep my {current.name} plan
                  </s-button>
                )}
              </div>
            );
          })}
        </div>

        {/* ---- full comparison ---- */}
        <div
          style={{
            background: "#fff",
            borderRadius: 12,
            border: "1px solid #e3e3e3",
            boxShadow: "0 1px 3px rgba(0,0,0,.08)",
            padding: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 650 }}>
              Compare all features
            </span>
            <s-button
              variant="tertiary"
              onClick={() => setShowCompare((v) => !v)}
            >
              {showCompare ? "Hide" : "Show"}
            </s-button>
          </div>
          {showCompare && (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                marginTop: 12,
                fontSize: 13,
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px 6px",
                      borderBottom: "1px solid #e3e3e3",
                    }}
                  />
                  {d.plans.map((p) => (
                    <th
                      key={p.id}
                      style={{
                        textAlign: "left",
                        padding: "8px 6px",
                        borderBottom: "1px solid #e3e3e3",
                      }}
                    >
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.comparison.map(([label, ...cells]) => (
                  <tr key={label}>
                    <td
                      style={{
                        padding: "8px 6px",
                        borderBottom: "1px solid #f1f1f1",
                      }}
                    >
                      {label}
                    </td>
                    {cells.map((c, i) => (
                      <td
                        key={i}
                        style={{
                          padding: "8px 6px",
                          borderBottom: "1px solid #f1f1f1",
                        }}
                      >
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
