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
import { addDays } from "../lib/dates";
import { formatSummary, type DisplaySettings, type Unit } from "../lib/format";
import { PLANS, planShippingDays, plansWith } from "../lib/plans";
import { ensureShop } from "../lib/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  return {
    settings: {
      unit: shop.unit,
      showCurrent: shop.showCurrent,
      showDispatch: shop.showDispatch,
      showDelivery: shop.showDelivery,
      showPrecip: shop.showPrecip,
      showLocation: shop.showLocation,
      skipWeekends: shop.skipWeekends,
    },
    // Fixed by the plan (read-only here).
    shipping: planShippingDays(shop),
    plan: PLANS[shop.plan],
    flowPlans: plansWith((p) => p.flowAutomation),
  };
};

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await ensureShop(session.shop);
  const body = (await request.json()) as Record<string, unknown>;
  const unit: Unit =
    body.unit === "F" || body.unit === "BOTH" ? body.unit : "C";

  // Whitelisted fields only — never pass the body to Prisma.
  const data: Record<string, unknown> = {
    unit,
    showCurrent: body.showCurrent === true,
    showDispatch: body.showDispatch === true,
    showDelivery: body.showDelivery === true,
    showPrecip: body.showPrecip === true,
    showLocation: body.showLocation === true,
    skipWeekends: body.skipWeekends === true,
    settingsSavedAt: new Date(),
  };
  await prisma.shop.update({ where: { shop: session.shop }, data });
  return { ok: true };
};

// Fixed sample so the preview looks the same every day.
const today = "2026-10-12";
const SAMPLE = {
  schema: 1 as const,
  provider: "openweather",
  fetchedAt: `${today}T09:00:00Z`,
  location: { city: "Austin", countryCode: "US", lat: 30.3, lon: -97.7 },
  current: {
    tempC: 27.4,
    tempF: 81,
    code: 1,
    label: "Mostly clear",
    observedAt: `${today}T09:00`,
  },
  dispatch: {
    date: addDays(today, 1),
    status: "ok" as const,
    minC: 19,
    maxC: 29,
    precipProb: 10,
    code: 2,
    label: "Partly cloudy",
  },
  delivery: {
    date: addDays(today, 4),
    status: "ok" as const,
    minC: 17,
    maxC: 24,
    precipProb: 60,
    code: 63,
    label: "Rain",
  },
};

export default function Settings() {
  const loaded = useLoaderData<typeof loader>();
  const [s, setS] = useState(loaded.settings);
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Settings saved");
  }, [fetcher.data, shopify]);

  const display: DisplaySettings = {
    ...s,
    showDispatch: s.showDispatch && loaded.plan.dispatchForecast,
  };
  const preview = formatSummary(
    loaded.plan.dispatchForecast
      ? SAMPLE
      : {
          ...SAMPLE,
          dispatch: { date: SAMPLE.dispatch.date, status: "hidden" },
        },
    display,
  );

  const toggle = (key: keyof typeof s, label: string, disabled = false) => (
    <s-checkbox
      label={label}
      checked={Boolean(s[key])}
      disabled={disabled}
      onChange={(e) => setS({ ...s, [key]: e.currentTarget.checked })}
    />
  );

  // Save stays faded until something differs from what's saved (the
  // loader re-runs after a save, so it fades again once stored).
  const dirty =
    (Object.keys(s) as (keyof typeof s)[]).some(
      (k) => s[k] !== loaded.settings[k],
    );

  const save = () =>
    fetcher.submit(
      { ...s },
      { method: "POST", encType: "application/json" },
    );

  return (
    <s-page heading="Settings">
      <s-button
        slot="primary-action"
        onClick={save}
        disabled={!dirty}
        {...(fetcher.state !== "idle" ? { loading: true } : {})}
      >
        Save
      </s-button>

      <s-section heading="Preview">
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <s-text>{preview || "Nothing selected to show."}</s-text>
        </s-box>
        <s-paragraph>
          New settings apply to orders from now on. Orders that already have
          weather keep their saved text, so reprints don&apos;t change.
        </s-paragraph>
      </s-section>

      <s-section heading="What to show">
        <s-select
          label="Temperature unit"
          value={s.unit}
          onChange={(e) => setS({ ...s, unit: e.currentTarget.value as Unit })}
        >
          <s-option value="C">Celsius (°C)</s-option>
          <s-option value="F">Fahrenheit (°F)</s-option>
          <s-option value="BOTH">Both</s-option>
        </s-select>
        {toggle("showLocation", "Destination city")}
        {toggle("showCurrent", "Current temperature")}
        {toggle(
          "showDispatch",
          loaded.plan.dispatchForecast
            ? "Dispatch-day forecast"
            : "Dispatch-day forecast (paid plans)",
          !loaded.plan.dispatchForecast,
        )}
        {toggle("showDelivery", "Delivery-day forecast")}
        {toggle("showPrecip", "Chance of rain (when 20% or more)")}
      </s-section>

      <s-section heading="Shipping dates">
        {/* Fixed by the plan (user decision 2026-10-14) — not editable. */}
        <s-stack direction="block" gap="small-200">
          <s-text>
            <strong>Handling time:</strong> {days(loaded.shipping.handlingDays)} from order to
            dispatch
          </s-text>
          <s-text>
            <strong>Transit time:</strong> {days(loaded.shipping.transitDays)} from dispatch to
            delivery
          </s-text>
          <s-text color="subdued">
            Set by your {loaded.plan.name} plan.{" "}
            {loaded.plan.name !== "Business" && (
              <>
                Higher plans allow a longer transit time, so the slip can forecast further
                ahead — <s-link href="/app/plans">see plans</s-link>.
              </>
            )}
          </s-text>
        </s-stack>
        {toggle("skipWeekends", "Count weekdays only")}
        <s-paragraph>
          Once an order ships, its real fulfillment date and the carrier&apos;s
          estimated delivery date are used instead, when Shopify has them.
        </s-paragraph>
      </s-section>

      <FlowGuide available={loaded.plan.flowAutomation} plans={loaded.flowPlans} />
    </s-page>
  );
}

const FLOW_STEPS: React.ReactNode[] = [
  <>
    Open{" "}
    <s-link href="shopify://admin/apps/flow" target="_blank">
      Shopify Flow
    </s-link>{" "}
    and click <strong>Create workflow</strong>.
  </>,
  <>
    Click <strong>Select a trigger</strong> and choose <strong>Order paid</strong>.
  </>,
  <>
    Click <strong>Add action</strong>, search for <strong>Weather</strong> and choose{" "}
    <strong>Save weather on order</strong> (Weather-Slip action).
  </>,
  <>
    In the action&apos;s Configuration, check that <strong>Order</strong> shows{" "}
    <strong>order.id</strong> — the order from the trigger. It&apos;s filled in for you.
  </>,
  <>
    Give the workflow a name (e.g. &ldquo;Save weather when paid&rdquo;) and click{" "}
    <strong>Turn on workflow</strong>.
  </>,
];

/**
 * Step-by-step Shopify Flow setup (Pro and Business). Shopify has no API
 * for an app to create a merchant's workflow; the published Flow template
 * (extensions/weather-slip-flow-paid) will add a one-click link here.
 */
function FlowGuide({ available, plans }: { available: boolean; plans: string }) {
  return (
    <s-section heading="Save weather automatically with Shopify Flow">
      <div id="flow" />
      {!available ? (
        <s-paragraph>
          On the {plans} plans, Shopify Flow can save each order&apos;s weather the moment
          it&apos;s paid or fulfilled, so its slip prints instantly.{" "}
          <s-link href="/app/plans">See plans</s-link>
        </s-paragraph>
      ) : (
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Save each order&apos;s weather as soon as it&apos;s paid, so Shopify&apos;s own
            packing slip shows it and printing is instant. Saving doesn&apos;t use your
            plan&apos;s prints — printing the slip does. Takes about a minute:
          </s-paragraph>
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
            {FLOW_STEPS.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <s-text type="strong">When you&apos;re done, it looks like this:</s-text>
          <img
            src="/help/flow-workflow.png"
            alt="Shopify Flow workflow: trigger Order paid, then the Weather-Slip action Save weather on order with Order set to order.id, and the Turn on workflow button at the top right."
            style={{
              display: "block",
              width: "100%",
              maxWidth: 760,
              height: "auto",
              border: "1px solid #e3e3e3",
              borderRadius: 8,
            }}
          />
          <s-paragraph>
            <strong>Also when it ships?</strong> Repeat the steps with the trigger{" "}
            <strong>Order fulfilled</strong>. An order that already has weather keeps it — the
            second workflow won&apos;t change or charge anything.
          </s-paragraph>
          <s-paragraph>
            <strong>Don&apos;t see the action?</strong> Reload Shopify Flow. It&apos;s listed
            under Apps → Weather-Slip, and only stores on the {plans} plans can run it.
          </s-paragraph>
        </s-stack>
      )}
    </s-section>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
