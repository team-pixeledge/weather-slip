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
  PAID_PLANS,
  PLAN_ORDER,
  PLANS,
  planFeatures,
  planFromBillingName,
  USAGE_PERIOD_DAYS,
  type PlanId,
} from "../lib/plans";
import { ensureShop } from "../lib/shop.server";
import { notifyAdmin } from "../lib/alerts.server";

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
    await notifyAdmin(
      "billing-failed",
      "A plan change failed",
      `Shop: ${session.shop}\nTarget plan: ${target}\n\n${err instanceof Error ? err.message : String(err)}`,
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

const CARD = {
  background: "#fff",
  borderRadius: 12,
  border: "1px solid #e3e3e3",
  boxShadow: "0 1px 3px rgba(0,0,0,.08)",
  padding: 16,
} as const;

const FAQ: [string, string][] = [
  [
    "What counts as an order?",
    "An order counts once, the first time its packing slip is printed with weather. Reprints are always free, and orders you never print never count. The weather is saved on the order, so every reprint shows exactly the same forecast.",
  ],
  [
    "What happens when I reach my plan's limit?",
    "Slips still print — just without the weather — until your monthly count resets or you upgrade. Orders already printed with weather keep it.",
  ],
  [
    "When does my monthly count reset?",
    "Every 30 days from when you installed the app. The date is shown in the Current plan box above.",
  ],
  [
    "How do upgrading and downgrading work?",
    "Choose a plan and approve the charge on Shopify's screen; the new plan starts straight away and Shopify prorates the difference, so you're never charged twice for the same days. If you don't approve, nothing changes.",
  ],
  [
    "How do I cancel or go back to Free?",
    "Click “Switch to Free” on the Free card. Your paid subscription is cancelled in Shopify right away and unused time is credited. You can upgrade again any time.",
  ],
  [
    "How is billing handled?",
    "All charges go through Shopify and appear on your regular Shopify invoice, billed every 30 days. Development stores only ever get free test charges.",
  ],
  [
    "Where does the weather come from, and how far ahead?",
    "Forecasts come from OpenWeather for the order's shipping city. The slip shows today plus the next 4 days at the destination, with the dispatch and delivery days marked. If the delivery day is further out, the slip says so.",
  ],
  [
    "Which printers and paper sizes work?",
    "Any printer your browser can print to. Choose A4, A5, US Letter or US Legal for full slips, or the Shipping label template for 4×6 or 4×4 thermal label printers.",
  ],
  [
    "What customer data does the app keep?",
    "None of your customers' names, street addresses, phone numbers or emails are stored — they're read from Shopify only while printing. The app keeps the city, country and the forecast for each printed order.",
  ],
];

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
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
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
                  // No height: 100% — the grid stretches cards to equal
                  // height; a percentage here resolved short and the
                  // buttons spilled under the comparison box.
                  minWidth: 0,
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
                  style={{ display: "flex", flexDirection: "column", gap: 5 }}
                >
                  {p.features.map((f) => (
                    <div
                      key={f.text}
                      style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "flex-start",
                        fontSize: 12.5,
                        lineHeight: 1.35,
                        opacity: f.included ? 1 : 0.45,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          color: f.included ? "#29845a" : "#8a8a8a",
                          fontWeight: 700,
                          width: 12,
                          flex: "none",
                        }}
                      >
                        {f.included ? "✓" : "✕"}
                      </span>
                      <span>
                        {f.text}
                        {!f.included && (
                          // Screen-reader only: the faded ✕ is visual.
                          <span
                            style={{
                              position: "absolute",
                              width: 1,
                              height: 1,
                              overflow: "hidden",
                              clip: "rect(0 0 0 0)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {" "}
                            (not included)
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
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
        {/* ---- How to use + FAQ ---- */}
        <div style={CARD}>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 8 }}>
            How to use Weather Slip
          </div>
          <ol
            style={{
              margin: 0,
              paddingLeft: 20,
              display: "grid",
              gap: 6,
              fontSize: 13,
            }}
          >
            <li>
              <strong>Print from Orders.</strong> Open{" "}
              <s-link href="/app">Orders</s-link>, tick one or more orders and
              click <em>Print packing slips</em> — or <em>Print slip</em> on a
              single row. The slip opens in a new tab; print it or save it as
              PDF.
            </li>
            <li>
              <strong>Make it yours.</strong> In{" "}
              <s-link href="/app/slip">Packing slip</s-link> pick a template
              (Classic, Minimal, Detailed or Shipping label) and set your logo,
              colours, fonts, line items and footer. The preview updates as you
              go.
            </li>
            <li>
              <strong>Or print from Shopify.</strong> In Shopify&apos;s own
              Orders page select orders → <em>Print</em> → <em>Weather slip</em>
              , or open an order → <em>More actions</em> → <em>Print</em> →{" "}
              <em>Weather slip</em>.
            </li>
            <li>
              <strong>Shipping days.</strong> In{" "}
              <s-link href="/app/settings">Settings</s-link> set your handling
              and transit days so the dispatch and delivery days on the slip are
              right.
            </li>
            <li>
              <strong>Optional:</strong> add the weather line to Shopify&apos;s
              own packing slip or Order Printer from{" "}
              <s-link href="/app/snippets">Shopify templates</s-link>.
            </li>
          </ol>
        </div>

        <div style={CARD}>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 4 }}>
            FAQ
          </div>
          {FAQ.map(([q, a]) => (
            <details
              key={q}
              style={{ borderTop: "1px solid #ebebeb", padding: "10px 0" }}
            >
              <summary
                style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}
              >
                {q}
              </summary>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 13,
                  color: "#4a4a4a",
                  lineHeight: 1.5,
                }}
              >
                {a}
              </div>
            </details>
          ))}
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
