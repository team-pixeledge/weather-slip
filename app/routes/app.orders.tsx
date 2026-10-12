import { useRef, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { listOrders } from "../lib/orders.server";
import { MAX_PRINT_ORDERS, ORDER_VIEWS, type OrderView } from "../lib/order-views";
import { ensureShop } from "../lib/shop.server";
import { isSlipTemplate, SLIP_TEMPLATES, type SlipTemplate } from "../lib/slip";
import { signPrintToken } from "../lib/print-token.server";

const WEATHER_LABEL: Record<string, string> = {
  OK: "Saved",
  PENDING_DATES: "Waiting for forecast",
  NO_LOCATION: "No address",
  LIMIT_REACHED: "Plan limit",
  FAILED: "Failed",
};

const FULFILLMENT_LABEL: Record<string, string> = {
  UNFULFILLED: "Unfulfilled",
  PARTIALLY_FULFILLED: "Partially fulfilled",
  ON_HOLD: "On hold",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  OPEN: "Open",
  FULFILLED: "Fulfilled",
  PENDING_FULFILLMENT: "Pending",
  REQUEST_DECLINED: "Request declined",
};

const humanise = (s: string | null) =>
  s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") : "—";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const viewParam = url.searchParams.get("view");
  const view: OrderView = ORDER_VIEWS.some((v) => v.id === viewParam)
    ? (viewParam as OrderView)
    : "unfulfilled";
  const search = (url.searchParams.get("q") ?? "").slice(0, 200);

  const { rows, pageInfo } = await listOrders(admin, {
    view,
    search,
    after: url.searchParams.get("after"),
    before: url.searchParams.get("before"),
  });

  const snaps = rows.length
    ? await prisma.$queryRaw<{ orderId: string; status: string }[]>`
        SELECT DISTINCT ON ("orderId") "orderId", status
          FROM "OrderWeatherSnapshot"
         WHERE shop = ${session.shop} AND "orderId" = ANY(${rows.map((r) => r.id)})
         ORDER BY "orderId", version DESC`
    : [];
  const weather = Object.fromEntries(snaps.map((s) => [s.orderId, s.status]));

  return {
    view,
    search,
    rows: rows.map((r) => ({ ...r, weather: weather[r.id] ?? null })),
    pageInfo,
    printToken: signPrintToken(session.shop),
    defaultTemplate: (await ensureShop(session.shop)).slipTemplate as SlipTemplate,
  };
};

export default function Orders() {
  const { view, search, rows, pageInfo, printToken, defaultTemplate } =
    useLoaderData<typeof loader>();
  // Template for this print; starts at the shop's saved default.
  const [template, setTemplate] = useState<SlipTemplate>(defaultTemplate);
  const [, setParams] = useSearchParams();
  const navigation = useNavigation();
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  // Seeded from the URL once; after that the field is the source of truth
  // and pushes into the URL (debounced).
  const [query, setQuery] = useState(search);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  const update = (changes: Record<string, string | null>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      return next;
    });

  const onSearch = (value: string) => {
    setQuery(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => update({ q: value, after: null, before: null }), 400);
  };

  const toggle = (id: string, name: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (on) next.set(id, name);
      else next.delete(id);
      return next;
    });

  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectPage = (on: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      for (const r of rows) {
        if (on) next.set(r.id, r.name);
        else next.delete(r.id);
      }
      return next;
    });

  const tooMany = selected.size > MAX_PRINT_ORDERS;
  const openPrint = (kind: "slips" | "customers", ids: string[]) => {
    const u = new URL(`/print/${kind}`, window.location.origin);
    u.searchParams.set("t", printToken);
    u.searchParams.set("ids", ids.join(","));
    if (kind === "slips" && template !== defaultTemplate) u.searchParams.set("tpl", template);
    window.open(u.toString(), "_blank", "noopener");
  };
  const selectedIds = [...selected.keys()];
  const loading = navigation.state !== "idle";

  return (
    <s-page heading="Orders" inlineSize="large">
      <s-button
        slot="primary-action"
        disabled={selected.size === 0 || tooMany}
        onClick={() => openPrint("slips", selectedIds)}
      >
        Print packing slips{selected.size ? ` (${selected.size})` : ""}
      </s-button>
      <s-button
        slot="secondary-actions"
        disabled={selected.size === 0 || tooMany}
        onClick={() => openPrint("customers", selectedIds)}
      >
        Print customer list
      </s-button>

      {tooMany && (
        <s-banner tone="warning">
          You can print up to {MAX_PRINT_ORDERS} orders at a time — {selected.size} are selected.
        </s-banner>
      )}

      <s-section padding="none">
        <s-table
          paginate
          hasNextPage={pageInfo.hasNextPage}
          hasPreviousPage={pageInfo.hasPreviousPage}
          loading={loading}
          onNextPage={() => update({ after: pageInfo.endCursor, before: null })}
          onPreviousPage={() => update({ before: pageInfo.startCursor, after: null })}
        >
          <s-stack slot="filters" direction="inline" gap="base" alignItems="center">
            <s-select
              label="Show"
              labelAccessibilityVisibility="exclusive"
              value={view}
              onChange={(e) =>
                update({ view: e.currentTarget.value, after: null, before: null })
              }
            >
              {ORDER_VIEWS.map((v) => (
                <s-option key={v.id} value={v.id}>
                  {v.label}
                </s-option>
              ))}
            </s-select>
            <s-search-field
              label="Search orders"
              labelAccessibilityVisibility="exclusive"
              placeholder="Order number, customer, email, SKU…"
              value={query}
              onInput={(e) => onSearch(e.currentTarget.value)}
            />
            <s-select
              label="Slip template"
              labelAccessibilityVisibility="exclusive"
              value={template}
              onChange={(e) => {
                const v = e.currentTarget.value;
                if (isSlipTemplate(v)) setTemplate(v);
              }}
            >
              {SLIP_TEMPLATES.map((t) => (
                <s-option key={t.id} value={t.id}>
                  {t.name}
                  {t.id === defaultTemplate ? " (default)" : ""}
                </s-option>
              ))}
            </s-select>
            <s-checkbox
              label="Select page"
              checked={allOnPage}
              disabled={rows.length === 0}
              onChange={(e) => selectPage(e.currentTarget.checked)}
            />
            {selected.size > 0 && (
              <s-button variant="tertiary" onClick={() => setSelected(new Map())}>
                Clear {selected.size} selected
              </s-button>
            )}
          </s-stack>

          <s-table-header-row>
            <s-table-header listSlot="inline"></s-table-header>
            <s-table-header listSlot="primary">Order</s-table-header>
            <s-table-header>Date</s-table-header>
            <s-table-header listSlot="secondary">Customer</s-table-header>
            <s-table-header>Destination</s-table-header>
            <s-table-header format="numeric">Items</s-table-header>
            <s-table-header format="currency">Total</s-table-header>
            <s-table-header>Payment</s-table-header>
            <s-table-header listSlot="labeled">Fulfillment</s-table-header>
            <s-table-header>Weather</s-table-header>
            <s-table-header></s-table-header>
          </s-table-header-row>
          <s-table-body>
            {rows.map((r) => (
              <s-table-row key={r.id}>
                <s-table-cell>
                  <s-checkbox
                    accessibilityLabel={`Select ${r.name}`}
                    checked={selected.has(r.id)}
                    onChange={(e) => toggle(r.id, r.name, e.currentTarget.checked)}
                  />
                </s-table-cell>
                <s-table-cell>
                  <s-link href={`shopify://admin/orders/${r.id}`}>{r.name}</s-link>
                </s-table-cell>
                <s-table-cell>
                  {new Date(r.createdAt).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </s-table-cell>
                <s-table-cell>{r.customer ?? "—"}</s-table-cell>
                <s-table-cell>{r.destination ?? "No shipping address"}</s-table-cell>
                <s-table-cell>{r.itemCount}</s-table-cell>
                <s-table-cell>
                  {new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency: r.currency,
                  }).format(Number(r.total))}
                </s-table-cell>
                <s-table-cell>{humanise(r.financialStatus)}</s-table-cell>
                <s-table-cell>
                  <s-badge
                    tone={
                      r.fulfillmentStatus === "FULFILLED"
                        ? "success"
                        : r.fulfillmentStatus === "ON_HOLD"
                          ? "caution"
                          : "warning"
                    }
                  >
                    {FULFILLMENT_LABEL[r.fulfillmentStatus] ?? humanise(r.fulfillmentStatus)}
                  </s-badge>
                </s-table-cell>
                <s-table-cell>{r.weather ? (WEATHER_LABEL[r.weather] ?? r.weather) : "—"}</s-table-cell>
                <s-table-cell>
                  <s-button variant="tertiary" onClick={() => openPrint("slips", [r.id])}>
                    Slip
                  </s-button>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {rows.length === 0 && !loading && (
          <s-box padding="base">
            <s-paragraph>
              {search ? "No orders match your search." : "No orders to show here."}
            </s-paragraph>
          </s-box>
        )}
      </s-section>

      <s-section slot="aside" heading="Printing">
        <s-paragraph>
          Choose the slip template next to the search box; change the default
          and slip options in <s-link href="/app/slip">Packing slip</s-link>.
        </s-paragraph>
        <s-paragraph>
          Packing slips open in a new tab with the destination&apos;s forecast
          for every day available (today plus the next few days), with the
          dispatch and delivery days marked. Print, or choose “Save as PDF”.
        </s-paragraph>
        <s-paragraph>
          The slip uses the latest forecast at print time. An order counts
          toward your plan the first time it&apos;s printed with weather;
          reprints are free. Printing also saves the weather on the order for
          Shopify&apos;s own packing slip and invoices.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
