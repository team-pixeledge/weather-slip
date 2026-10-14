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
import { PLANS } from "../lib/plans";
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
      handlingDays: shop.handlingDays,
      transitDays: shop.transitDays,
      skipWeekends: shop.skipWeekends,
    },
    plan: PLANS[shop.plan],
  };
};

const clampDays = (v: unknown) =>
  Math.min(30, Math.max(0, Math.trunc(Number(v) || 0)));

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
    handlingDays: clampDays(body.handlingDays),
    transitDays: clampDays(body.transitDays),
    skipWeekends: body.skipWeekends === true,
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
        <s-number-field
          label="Handling time (days from order to dispatch)"
          value={String(s.handlingDays)}
          min={0}
          max={30}
          onChange={(e) =>
            setS({ ...s, handlingDays: Number(e.currentTarget.value) })
          }
        />
        <s-number-field
          label="Transit time (days from dispatch to delivery)"
          value={String(s.transitDays)}
          min={0}
          max={30}
          onChange={(e) =>
            setS({ ...s, transitDays: Number(e.currentTarget.value) })
          }
        />
        {toggle("skipWeekends", "Count weekdays only")}
        <s-paragraph>
          Once an order ships, its real fulfillment date and the carrier&apos;s
          estimated delivery date are used instead, when Shopify has them.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
