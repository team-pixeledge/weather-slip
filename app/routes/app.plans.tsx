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
  annualSavingPct,
  intervalFromBillingName,
  PAID_PLANS,
  PLAN_ORDER,
  PLANS,
  planFeatures,
  planFromBillingName,
  USAGE_PERIOD_DAYS,
  type BillingInterval,
  type PlanId,
} from "../lib/plans";
import {
  ensureShop,
  isChecklistStep,
  setChecklistStep,
  usageSummary,
  type ChecklistStep,
} from "../lib/shop.server";
import { UsageBanner } from "../components/UsageBanner";
import { notifyAdmin } from "../lib/alerts.server";
import { captureError } from "../lib/sentry.server";

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
  const [failedJobs, printedOrders] = await Promise.all([
    prisma.weatherJob.count({ where: { shop: session.shop, status: "FAILED" } }),
    prisma.countedOrder.count({ where: { shop: session.shop } }),
  ]);
  // Onboarding checklist: steps the app can see are ticked from the shop's
  // own data; the rest (done outside the app) stay as plain how-tos.
  const features = PLANS[billing.plan];
  const checklist = {
    slipSaved: shop.slipDesign != null,
    printed: printedOrders > 0,
    printFromShopify: features.printFromShopify,
    flowAutomation: features.flowAutomation,
    // Outside-the-app steps: ticked when the app saw them happen, or by hand.
    outside: shop.checklistDone.filter(isChecklistStep),
  };

  const usage = {
    ...usageSummary({ ...shop, plan: billing.plan }, now),
    canUpgrade: billing.plan !== "BUSINESS",
  };

  return {
    usage,
    current: billing.plan,
    interval: billing.interval,
    subscription: billing.subscription,
    testCharge: billing.testCharge,
    used: elapsed ? 0 : shop.usageCount,
    resetsAt: new Date(resetsAt).toISOString(),
    failedJobs,
    checklist,
    returned: returned
      ? {
          status: returned.status,
          plan: planFromBillingName(returned.name),
          interval: intervalFromBillingName(returned.name),
        }
      : chargeId
        ? { status: "UNKNOWN", plan: null, interval: "MONTHLY" as BillingInterval }
        : null,
    plans: PLAN_ORDER.map((id) => ({
      id,
      ...PLANS[id],
      annualSaving: annualSavingPct(id),
      features: planFeatures(id),
    })),
  };
};

type ActionResult =
  | { ok: true; confirmationUrl: string }
  | { ok: true; switchedTo: PlanId }
  | { ok: true; checklist: true }
  | { ok: false; error: string };

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  // "Mark as done" / "Undo" on a Get started step done outside the app.
  if (form.get("intent") === "checklist") {
    const step = form.get("step");
    if (!isChecklistStep(step)) return { ok: false, error: "Unknown step." };
    await setChecklistStep(session.shop, step, form.get("done") === "1");
    return { ok: true, checklist: true };
  }
  const target = String(form.get("plan")) as PlanId;
  const interval: BillingInterval =
    form.get("interval") === "ANNUAL" ? "ANNUAL" : "MONTHLY";
  if (!PLAN_ORDER.includes(target))
    return { ok: false, error: "Unknown plan." };

  try {
    const billing = await syncPlan(admin, session.shop);
    if (
      billing.plan === target &&
      (target === "FREE" || billing.interval === interval)
    )
      return { ok: true, switchedTo: target };

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
        interval,
      });
      return { ok: true, confirmationUrl };
    }
  } catch (err) {
    console.error(
      "[plans] plan change failed",
      err instanceof Error ? err.message : err,
    );
    captureError(err, { where: "plan-change", shop: session.shop, target, interval });
    await notifyAdmin(
      "billing-failed",
      "A plan change failed",
      `Shop: ${session.shop}\nTarget plan: ${target} (${interval})\n\n${err instanceof Error ? err.message : String(err)}`,
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
    "What counts toward my plan?",
    "Every slip you print with weather: each order on each print uses one from your monthly allowance — printing 20 slips uses 20, and reprinting an order uses one more. Printing the same order again within 10 minutes is free (a reload, Shopify's print preview, a second copy for the box). Orders you never print never count, and neither does the customer list; saving weather with Shopify Flow doesn't count either — the print does. The weather is saved on the order, so every reprint shows exactly the same forecast.",
  ],
  [
    "How do I see which slips are already printed?",
    "On the Orders page an order whose slip has been printed is faded, shows a green badge with how many times it was printed (e.g. “2 Printed”) — hover it to see every print date, and its button says Reprint. Printing the same order again within 10 minutes doesn't add to the count.",
  ],
  [
    "If I re-pack an order and print its slip again, is that charged?",
    "Yes, one print — unless it's within 10 minutes of the last print of that order. The reprint shows the same saved forecast; it doesn't fetch new weather.",
  ],
  [
    "What happens when I reach my plan's limit?",
    "Slips still print — just without the weather, reprints included — until your monthly count resets or you upgrade. You get an email at 80% and at 100%.",
  ],
  [
    "When does my monthly count reset?",
    "Every 30 days from when you installed the app, on monthly and yearly billing alike. The date is shown in the Current plan box above.",
  ],
  [
    "What does each plan include?",
    "Free: 30 prints a month, the Classic template, today + 2 days of forecast, unfulfilled orders. Starter: 500 prints, adds the Minimal template, the dispatch-day forecast, printing from Shopify's Orders page, the customer list, the Order Printer setup guide and a watermark word (PAID, FRAGILE, GIFT…). Pro: 2,000 prints, adds today + 3 days of forecast, the Detailed template with prices, every order view (fulfilled, unpaid, cancelled, archived), slips in 7 languages, distance to the customer, Shopify Flow and a watermark with your own text. Business: 5,000 prints, adds today + 4 days of forecast, the 4×6 / 4×4 shipping label, a logo watermark, and removes the Weather Slip mark.",
  ],
  [
    "Which orders are listed?",
    "Free and Starter list and print unfulfilled and partially fulfilled orders — partially fulfilled ones print only the items still to ship, and an order printed before it shipped can always be reprinted. Free slips show the delivery day; the dispatch day is on Starter and up. Dispatch and delivery dates use shipping days set by the plan — 1 handling day, then 1 transit day on Free and Starter, 2 on Pro, 3 on Business — or the real fulfillment and carrier dates once the order ships. Pro and Business can also open fulfilled, unpaid, cancelled and archived orders. POS sales and local pickup orders are never listed: they have no shipping address, so there's nothing to forecast.",
  ],
  [
    "What do the warning badges and the tip on the slip mean?",
    "A dispatch or delivery day with a 60% or higher chance of rain, freezing temperatures (0 °C / 32 °F or below) or heat of 35 °C / 95 °F or more gets a coloured warning badge. If delivery day is one of those, the slip adds a one-line tip for your customer, such as “Rain expected on delivery day: please bring the parcel in quickly.” Turn the tip off in Packing slip → Weather.",
  ],
  [
    "Can I print fewer forecast days, or a code warehouses can scan?",
    "Yes. In Packing slip → Weather choose “Dispatch to delivery only” to show just the days the parcel travels. In Logo & header choose a QR code or a Code 128 barcode of the order number.",
  ],
  [
    "Can I add a watermark?",
    "Yes, in Packing slip → Watermark: a faint word or logo behind every slip, in your accent colour, with size, angle and strength. Starter picks a word (PAID, FRAGILE, GIFT, HANDLE WITH CARE…), Pro and Business type their own, and Business can use its logo.",
  ],
  [
    "Can slips print in another language? (Pro and Business)",
    "Yes — English, French, German, Spanish, Italian, Portuguese or Dutch, set in Packing slip → Language. Headings, dates, weather and the thank-you line are translated; your own texts print as you type them.",
  ],
  [
    "How does the Shopify Flow automation work? (Pro and Business)",
    "In Shopify Flow, start a workflow with “Order paid” or “Order fulfilled” and add the Weather Slip action “Save weather on order”. Each order then gets its forecast saved straight away, so Shopify's own packing slip shows it, and it appears under “ready to print” at the top of Weather Slip's Orders page — one click prints all of them. (No app can make your printer start by itself; a browser only prints from a page you have open.) Saving doesn't use your allowance; printing the slip does. Settings has a step-by-step guide with a picture of the finished workflow.",
  ],
  [
    "How do upgrading and downgrading work?",
    "Choose a plan and approve the charge on Shopify's screen; the new plan starts straight away and Shopify prorates the difference, so you're never charged twice for the same days. If you don't approve, nothing changes. Settings for features a lower plan doesn't include are kept, so they come back if you upgrade again.",
  ],
  [
    "Can I pay yearly?",
    "Yes — switch the plan cards to Yearly. Starter is $49, Pro $99 and Business $199 a year, about two months free. Your print allowance is the same as monthly and resets every 30 days.",
  ],
  [
    "How do I cancel or go back to Free?",
    "Click “Switch to Free” on the Free card. Your paid subscription is cancelled in Shopify right away and unused time is credited. You can upgrade again any time.",
  ],
  [
    "How is billing handled?",
    "All charges go through Shopify and appear on your regular Shopify invoice. Development stores only ever get free test charges.",
  ],
  [
    "Where does the weather come from, and how far ahead?",
    "Weather data © OpenWeather (openweathermap.org), used under the Open Database License (ODbL); every slip carries that credit. The forecast is for the order's shipping city. It is fetched when the order's slip is first printed (or when Shopify Flow saves it) and saved on the order — it isn't live weather, and slips printed from the app reprint that saved forecast. One exception: if an order still hasn't shipped after its dispatch day has passed, the next print moves dispatch to today (and delivery along with it) and fetches the forecast again for the new days. The slip shows today at the destination plus the next 2 days on Free and Starter, 3 on Pro and 4 on Business (or only dispatch to delivery within that, if you choose it in Packing slip → Weather), with the dispatch and delivery days marked and, by default, the time the forecast was taken. If the delivery day is further out, the slip says so. The one-line weather on Shopify's own packing slip follows the saved weather too; it's updated only if the shipping address changes before the order ships, a day that was beyond the forecast range comes into range, or a missed dispatch day moves to today, and it's frozen once the order is fulfilled.",
  ],
  [
    "Which printers and paper sizes work?",
    "Any printer your browser can print to. Choose A4, A5, US Letter or US Legal for full slips, or (on Business) the Shipping label template for 4×6 or 4×4 thermal label printers. The Minimal template saves ink on black-and-white printers.",
  ],
  [
    "What customer data does the app keep?",
    "None of your customers' names, street addresses or phone numbers are stored — they're read from Shopify only while printing. The app keeps the city, country, an approximate location (rounded to about 11 km) and the forecast for each printed order, and deletes them when Shopify sends a customer or shop data-deletion request.",
  ],
];

interface ChecklistState {
  slipSaved: boolean;
  printed: boolean;
  printFromShopify: boolean;
  flowAutomation: boolean;
  outside: ChecklistStep[];
}

/**
 * Getting started. Every step the plan includes counts toward "n of m".
 * `step` = done outside the app (Shopify's print menu, Flow, the Liquid
 * snippet): ticked automatically when the app sees it happen
 * (Shop.checklistDone), or by the merchant's "Mark as done". `plan` = the
 * step needs a higher plan (shown, not counted).
 */
function Checklist({ c }: { c: ChecklistState }) {
  const steps: {
    title: string;
    body: React.ReactNode;
    done: boolean;
    /** Done outside the app: the merchant can tick it by hand. */
    step?: ChecklistStep;
    plan?: string;
  }[] = [
    {
      title: "Design your packing slip",
      done: c.slipSaved,
      body: (
        <>
          In <s-link href="/app/slip">Packing slip</s-link> pick a template and
          set your logo, colours, language, forecast days, weather tip and
          QR code or barcode. Save once to tick this off.
        </>
      ),
    },
    {
      title: "Print your first slip",
      done: c.printed,
      body: (
        <>
          Open <s-link href="/app">Orders</s-link>, tick orders and click{" "}
          <em>Print packing slips</em>. The slip opens in a new tab; print it
          or save it as PDF. Each print uses one from your plan.
        </>
      ),
    },
    {
      title: "Print from Shopify's own Orders page",
      step: "printFromShopify",
      done: c.outside.includes("printFromShopify"),
      plan: c.printFromShopify ? undefined : "Starter",
      body: (
        <>
          In Shopify&apos;s Orders, select orders → <em>Print</em> →{" "}
          <em>Weather slip</em>, or open an order → <em>More actions</em> →{" "}
          <em>Print</em>.
        </>
      ),
    },
    {
      title: "Save weather automatically with Shopify Flow",
      step: "flow",
      done: c.outside.includes("flow"),
      plan: c.flowAutomation ? undefined : "Pro",
      body: (
        <>
          In{" "}
          <s-link href="shopify://admin/apps/flow" target="_blank">
            Shopify Flow
          </s-link>
          : trigger <em>Order paid</em> or <em>Order fulfilled</em> → action{" "}
          <em>Save weather on order</em> (Weather Slip) → Turn on.{" "}
          <s-link href="/app/settings#flow">Step-by-step guide with a picture</s-link>.
        </>
      ),
    },
    {
      title: "Optional: weather on Shopify's own packing slip",
      step: "snippet",
      done: c.outside.includes("snippet"),
      body: (
        <>
          Copy the snippet from{" "}
          <s-link href="/app/snippets">Shopify templates</s-link>.
        </>
      ),
    },
  ];
  const fetcher = useFetcher<typeof action>();
  // Optimistic while a "Mark as done"/"Undo" is on its way.
  if (fetcher.formData) {
    const step = fetcher.formData.get("step");
    for (const s of steps) if (s.step === step) s.done = fetcher.formData.get("done") === "1";
  }
  // Every step the plan includes counts; locked ones are shown, not counted.
  const tracked = steps.filter((s) => !s.plan);
  const doneCount = tracked.filter((s) => s.done).length;
  return (
    <div style={CARD}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 650 }}>Get started</span>
        <s-badge tone={doneCount === tracked.length ? "success" : "info"}>
          {`${doneCount} of ${tracked.length} done`}
        </s-badge>
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
        {steps.map((s, i) => (
          <li
            key={s.title}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              fontSize: 13,
              opacity: s.plan ? 0.6 : 1,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                flex: "none",
                width: 20,
                height: 20,
                borderRadius: 10,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 700,
                color: s.done ? "#fff" : "#4a4a4a",
                background: s.done ? "#29845a" : "#ebebeb",
              }}
            >
              {s.done ? "✓" : i + 1}
            </span>
            <span>
              <strong>{s.title}</strong>
              {s.done && <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}> (done)</span>}
              {s.plan && (
                <>
                  {" "}
                  <s-badge>{`${s.plan} plan`}</s-badge>
                </>
              )}
              {s.step && !s.plan && (
                <>
                  {" "}
                  <s-button
                    variant="tertiary"
                    onClick={() =>
                      fetcher.submit(
                        { intent: "checklist", step: s.step!, done: s.done ? "0" : "1" },
                        { method: "POST" },
                      )
                    }
                  >
                    {s.done ? "Undo" : "Mark as done"}
                  </s-button>
                </>
              )}
              <br />
              <span style={{ color: "#4a4a4a" }}>{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

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
  // Which prices the cards show; starts at what the shop pays now.
  const [interval, setPeriod] = useState<BillingInterval>(d.interval);
  const pending =
    fetcher.state !== "idle" ? String(fetcher.formData?.get("plan")) : null;
  const current = PLANS[d.current];
  const result = fetcher.data;

  useEffect(() => {
    if (!result?.ok) return;
    if ("confirmationUrl" in result) {
      // Shopify's approval screen must be a top-level page, not the iframe.
      window.open(result.confirmationUrl, "_top");
    } else if ("switchedTo" in result) {
      shopify.toast.show(`You're on the ${PLANS[result.switchedTo].name} plan`);
    }
  }, [result, shopify]);

  const choose = (plan: PlanId) => {
    setConfirmFree(false);
    fetcher.submit({ plan, interval }, { method: "POST" });
  };

  const limit = current.ordersPerPeriod;
  const pct = d.usage.pct;
  const rank = (id: PlanId) => PLAN_ORDER.indexOf(id);

  return (
    <s-page heading="Plans & pricing" inlineSize="large">
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
            Start free, or pick a paid plan. Plans count slips printed with
            weather, reprints included. Change or cancel your plan here
            anytime.
          </s-text>
        </div>

        <UsageBanner
          usage={d.usage}
          onUpgrade={() =>
            document.getElementById("all-plans")?.scrollIntoView({ behavior: "smooth" })
          }
        />

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
              {d.used.toLocaleString()} of {limit.toLocaleString()} prints
              with weather this month · resets {fmtDate(d.resetsAt)}
            </s-text>
            <div
              role="progressbar"
              aria-label="Prints used this month"
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
            heading={`${PLANS[d.returned.plan].name} plan activated${d.returned.interval === "ANNUAL" ? " (yearly)" : ""}`}
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
        <div
          id="all-plans"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: -4,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 650 }}>All plans</span>
          <div
            role="group"
            aria-label="Billing period"
            style={{ display: "flex", gap: 6, alignItems: "center" }}
          >
            <s-button
              variant={interval === "MONTHLY" ? "primary" : "secondary"}
              onClick={() => setPeriod("MONTHLY")}
            >
              Monthly
            </s-button>
            <s-button
              variant={interval === "ANNUAL" ? "primary" : "secondary"}
              onClick={() => setPeriod("ANNUAL")}
            >
              Yearly · save ~2 months
            </s-button>
          </div>
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
            const isFree = p.priceUsd === 0;
            const samePlan = p.id === d.current;
            // A paid plan is "active" only on the billing period shown.
            const isActive = samePlan && (isFree || d.interval === interval);
            const yearly = interval === "ANNUAL" && !isFree;
            const up = rank(p.id) > rank(d.current);
            const confirming = isFree && confirmFree;
            const label = isActive
              ? "Activated"
              : isFree
                ? confirming
                  ? `Yes, cancel ${current.name} and switch`
                  : "Switch to Free"
                : samePlan
                  ? yearly
                    ? "Switch to yearly billing"
                    : "Switch to monthly billing"
                  : up
                    ? `Upgrade to ${p.name}${yearly ? " (yearly)" : ""}`
                    : `Downgrade to ${p.name}${yearly ? " (yearly)" : ""}`;
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
                  {samePlan ? (
                    <s-badge tone="success">
                      {isFree || d.interval === "MONTHLY"
                        ? "Current plan"
                        : "Current plan · yearly"}
                    </s-badge>
                  ) : p.highlight ? (
                    <s-badge tone="info">{p.highlight}</s-badge>
                  ) : null}
                </s-stack>
                <div>
                  <span style={{ fontSize: 30, fontWeight: 700 }}>
                    {isFree
                      ? "$0"
                      : yearly
                        ? `$${p.annualPriceUsd}`
                        : `$${p.priceUsd.toFixed(2)}`}
                  </span>
                  <s-text color="subdued">{yearly ? " / year" : " / month"}</s-text>
                  <div>
                    <s-text color="subdued">
                      {isFree
                        ? "Free forever · no card needed"
                        : yearly
                          ? `≈ $${(p.annualPriceUsd / 12).toFixed(2)}/month · save ${p.annualSaving}% · billed yearly by Shopify`
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
                    {PLANS.FREE.ordersPerPeriod} prints a month with
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
        {/* ---- Onboarding checklist + FAQ ---- */}
        <Checklist c={d.checklist} />

        <div
          style={{
            ...CARD,
            width: "100%",
            maxWidth: 820,
            margin: "0 auto",
          }}
        >
          <div
            style={{
              fontSize: 15,
              fontWeight: 650,
              marginBottom: 8,
              textAlign: "center",
            }}
          >
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
          {/* In-app support contact (App Store requirement). */}
          <div
            style={{
              borderTop: "1px solid #ebebeb",
              paddingTop: 12,
              fontSize: 13,
              color: "#4a4a4a",
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: "#303030" }}>Need help?</strong> Email{" "}
            <s-link href="mailto:teampixeledge@gmail.com?subject=Weather%20Slip%20support" target="_blank">
              teampixeledge@gmail.com
            </s-link>{" "}
            — we usually reply within one business day. Step-by-step setup guide:{" "}
            <s-link href="https://thepixeledge.in/weather-slip/how-to-use/" target="_blank">
              How to install and use Weather Slip
            </s-link>
            {" · "}
            <s-link href="/privacy" target="_blank">
              Privacy policy
            </s-link>
          </div>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
