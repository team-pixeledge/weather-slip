import { useRef, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { listOrders } from "../lib/orders.server";
import {
  MAX_PRINT_ORDERS,
  ORDER_RANGES,
  ORDER_VIEWS,
  type OrderRange,
  type OrderView,
} from "../lib/order-views";
import { ensureShop } from "../lib/shop.server";
import { isSlipTemplate, SLIP_TEMPLATES, type SlipTemplate } from "../lib/slip";
import { signPrintToken } from "../lib/print-token.server";

// Laid out like Shopify's own Orders page (same tabs, columns and badges)
// so merchants already know how to read it; printing is a bulk action on
// the selection, like Shopify's.

const WEATHER_LABEL: Record<string, string> = {
  OK: "Saved",
  PENDING_DATES: "Pending",
  NO_LOCATION: "No address",
  LIMIT_REACHED: "Plan limit",
  FAILED: "Failed",
};

type Tone = "caution" | "warning" | "neutral" | "info";

const FULFILLMENT: Record<string, { label: string; tone: Tone }> = {
  UNFULFILLED: { label: "Unfulfilled", tone: "caution" },
  PARTIALLY_FULFILLED: { label: "Partially fulfilled", tone: "warning" },
  ON_HOLD: { label: "On hold", tone: "warning" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  PENDING_FULFILLMENT: { label: "Pending", tone: "info" },
  OPEN: { label: "Open", tone: "info" },
  FULFILLED: { label: "Fulfilled", tone: "neutral" },
  RESTOCKED: { label: "Restocked", tone: "neutral" },
  REQUEST_DECLINED: { label: "Request declined", tone: "warning" },
};

const PAYMENT: Record<string, { label: string; tone: Tone }> = {
  PAID: { label: "Paid", tone: "neutral" },
  PENDING: { label: "Payment pending", tone: "caution" },
  AUTHORIZED: { label: "Authorized", tone: "caution" },
  PARTIALLY_PAID: { label: "Partially paid", tone: "caution" },
  PARTIALLY_REFUNDED: { label: "Partially refunded", tone: "neutral" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  VOIDED: { label: "Voided", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "warning" },
};

const humanise = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

/** "Dec 1 at 6:45 am" this year, "Sep 11, 2025" before — like Shopify. */
function orderDate(iso: string): string {
  const d = new Date(iso);
  if (d.getFullYear() !== new Date().getFullYear()) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
  return `${day} at ${time}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const viewParam = url.searchParams.get("view");
  const view: OrderView = ORDER_VIEWS.some((v) => v.id === viewParam)
    ? (viewParam as OrderView)
    : "all";
  const search = (url.searchParams.get("q") ?? "").slice(0, 200);
  const rangeParam = url.searchParams.get("range");
  const range: OrderRange = ORDER_RANGES.some((r) => r.id === rangeParam)
    ? (rangeParam as OrderRange)
    : "any";

  const { rows, pageInfo } = await listOrders(admin, {
    view,
    search,
    range,
    after: url.searchParams.get("after"),
    before: url.searchParams.get("before"),
    pageSize: 50,
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
    range,
    rows: rows.map((r) => ({ ...r, weather: weather[r.id] ?? null })),
    pageInfo,
    printToken: signPrintToken(session.shop),
    defaultTemplate: (await ensureShop(session.shop)).slipTemplate as SlipTemplate,
  };
};

export default function Orders() {
  const { view, search, range, rows, pageInfo, printToken, defaultTemplate } =
    useLoaderData<typeof loader>();
  const [, setParams] = useSearchParams();
  const navigation = useNavigation();
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  // Template for this print; starts at the shop's saved default.
  const [template, setTemplate] = useState<SlipTemplate>(defaultTemplate);
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

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someOnPage = rows.some((r) => selected.has(r.id));
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
      <s-button slot="secondary-actions" href="/app/slip">
        Slip templates
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
          {selected.size > 0 ? (
            // Bulk actions replace the filters while orders are selected,
            // as on Shopify's Orders page.
            <s-stack slot="filters" direction="inline" gap="small-300" alignItems="center">
              <s-text type="strong">{selected.size} selected</s-text>
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
              <s-button
                variant="primary"
                disabled={tooMany}
                onClick={() => openPrint("slips", selectedIds)}
              >
                Print packing slips
              </s-button>
              <s-button disabled={tooMany} onClick={() => openPrint("customers", selectedIds)}>
                Print customer list
              </s-button>
              <s-button variant="tertiary" onClick={() => setSelected(new Map())}>
                Clear
              </s-button>
            </s-stack>
          ) : (
            <s-stack slot="filters" direction="inline" gap="small-300" alignItems="center">
              <s-select
                label="View"
                labelAccessibilityVisibility="exclusive"
                value={view}
                onChange={(e) => update({ view: e.currentTarget.value, after: null, before: null })}
              >
                {ORDER_VIEWS.map((v) => (
                  <s-option key={v.id} value={v.id}>
                    {v.label}
                  </s-option>
                ))}
              </s-select>
              <s-search-field
                label="Search and filter"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search and filter"
                value={query}
                onInput={(e) => onSearch(e.currentTarget.value)}
              />
              <s-select
                label="Date"
                labelAccessibilityVisibility="exclusive"
                value={range}
                onChange={(e) =>
                  update({
                    range: e.currentTarget.value === "any" ? null : e.currentTarget.value,
                    after: null,
                    before: null,
                  })
                }
              >
                {ORDER_RANGES.map((r) => (
                  <s-option key={r.id} value={r.id}>
                    {r.label}
                  </s-option>
                ))}
              </s-select>
            </s-stack>
          )}

          <s-table-header-row>
            <s-table-header listSlot="inline">
              <s-checkbox
                accessibilityLabel="Select all orders on this page"
                checked={allOnPage}
                indeterminate={someOnPage && !allOnPage}
                disabled={rows.length === 0}
                onChange={(e) => selectPage(e.currentTarget.checked)}
              />
            </s-table-header>
            <s-table-header listSlot="primary">Order</s-table-header>
            <s-table-header>Date</s-table-header>
            <s-table-header listSlot="secondary">Customer</s-table-header>
            <s-table-header>Channel</s-table-header>
            <s-table-header format="currency">Total</s-table-header>
            <s-table-header>Payment status</s-table-header>
            <s-table-header listSlot="labeled">Fulfillment status</s-table-header>
            <s-table-header>Items</s-table-header>
            <s-table-header>Delivery method</s-table-header>
            <s-table-header>Weather</s-table-header>
            <s-table-header>Tags</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {rows.map((r) => {
              const pay = r.financialStatus ? PAYMENT[r.financialStatus] : null;
              const ful = FULFILLMENT[r.fulfillmentStatus];
              return (
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
                  <s-table-cell>{orderDate(r.createdAt)}</s-table-cell>
                  <s-table-cell>{r.customer ?? "No customer"}</s-table-cell>
                  <s-table-cell>{r.channel ?? ""}</s-table-cell>
                  <s-table-cell>
                    {new Intl.NumberFormat(undefined, {
                      style: "currency",
                      currency: r.currency,
                    }).format(Number(r.total))}
                  </s-table-cell>
                  <s-table-cell>
                    {r.financialStatus && (
                      <s-badge tone={pay?.tone ?? "neutral"}>
                        {pay?.label ?? humanise(r.financialStatus)}
                      </s-badge>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={ful?.tone ?? "neutral"}>
                      {ful?.label ?? humanise(r.fulfillmentStatus)}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {r.itemCount} {r.itemCount === 1 ? "item" : "items"}
                  </s-table-cell>
                  <s-table-cell>{r.shippingMethod ?? ""}</s-table-cell>
                  <s-table-cell>
                    {r.weather ? (
                      <s-badge
                        tone={
                          r.weather === "OK"
                            ? "success"
                            : r.weather === "PENDING_DATES"
                              ? "info"
                              : "warning"
                        }
                      >
                        {WEATHER_LABEL[r.weather] ?? r.weather}
                      </s-badge>
                    ) : (
                      <s-button variant="tertiary" onClick={() => openPrint("slips", [r.id])}>
                        Print slip
                      </s-button>
                    )}
                  </s-table-cell>
                  <s-table-cell>{r.tags.join(", ")}</s-table-cell>
                </s-table-row>
              );
            })}
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
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
