import { useEffect, useRef, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation, useRevalidator, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { listOrders } from "../lib/orders.server";
import {
  AUTO_REFRESH_MS,
  DEFAULT_PAGE_SIZE,
  MAX_PRINT_ORDERS,
  PAGE_SIZES,
  ORDER_RANGES,
  ORDER_VIEWS,
  type OrderRange,
  type OrderView,
} from "../lib/order-views";
import { ensureShop, readyToPrintIds, slipOptions, usageSummary } from "../lib/shop.server";
import { UsageBanner } from "../components/UsageBanner";
import { isSlipTemplate, SLIP_TEMPLATES, type SlipTemplate } from "../lib/slip";
import { signPrintToken } from "../lib/print-token.server";
import { allowedView, PLANS, planSlipOptions, plansWith, templatePlan } from "../lib/plans";

// Laid out like Shopify's own Orders page (same tabs, columns and badges)
// so merchants already know how to read it; printing is a bulk action on
// the selection, like Shopify's.

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
  const shop = await ensureShop(session.shop);
  const plan = PLANS[shop.plan];
  const viewParam = url.searchParams.get("view");
  // Free and Starter list unfulfilled (incl. partially fulfilled) orders
  // only; the other views need Pro. Enforced here, not just in the UI.
  const view: OrderView = allowedView(
    ORDER_VIEWS.some((v) => v.id === viewParam) ? (viewParam as OrderView) : "all",
    shop.plan,
  );
  const search = (url.searchParams.get("q") ?? "").slice(0, 200);
  const rangeParam = url.searchParams.get("range");
  const range: OrderRange = ORDER_RANGES.some((r) => r.id === rangeParam)
    ? (rangeParam as OrderRange)
    : "any";

  const perParam = Number(url.searchParams.get("per"));
  const perPage = (PAGE_SIZES as readonly number[]).includes(perParam) ? perParam : DEFAULT_PAGE_SIZE;

  const usage = { ...usageSummary(shop), canUpgrade: shop.plan !== "BUSINESS" };

  // "Ready to print": weather saved by Shopify Flow, slip not printed yet,
  // still unfulfilled (checked with Shopify — an order shipped without a
  // slip drops out). ?ready=1 narrows the list to them.
  const readyCandidates = await readyToPrintIds(session.shop, new Date(), 100);
  const readyOnly = url.searchParams.get("ready") === "1" && readyCandidates.length > 0;
  const [{ rows, pageInfo }, ready] = await Promise.all([
    listOrders(admin, {
      view: readyOnly ? "unfulfilled" : view,
      search,
      range,
      after: url.searchParams.get("after"),
      before: url.searchParams.get("before"),
      pageSize: perPage,
      ...(readyOnly ? { ids: readyCandidates } : {}),
    }),
    readyCandidates.length
      ? listOrders(admin, { view: "unfulfilled", search: "", ids: readyCandidates, pageSize: 100 }).then((r) =>
          r.rows.map((o) => o.id),
        )
      : Promise.resolve([] as string[]),
  ]);

  // Which of these orders have had their slip printed (dimmed + "Reprint").
  const printed = rows.length
    ? await prisma.printedOrder.findMany({
        where: { shop: session.shop, orderId: { in: rows.map((r) => r.id) } },
        select: { orderId: true, printCount: true, lastPrintedAt: true, printedAt: true },
      })
    : [];
  const printedBy = new Map(printed.map((p) => [p.orderId, p]));
  const rowsWithPrints = rows.map((r) => {
    const p = printedBy.get(r.id);
    return {
      ...r,
      printed: p
        ? {
            count: p.printCount,
            // Newest first for the tooltip; rows from before the history
            // existed fall back to the latest print.
            dates: (p.printedAt.length ? p.printedAt : [p.lastPrintedAt]).map((d) => d.toISOString()).reverse(),
          }
        : null,
    };
  });


  return {
    view,
    readyOnly,
    ready,
    search,
    range,
    perPage,
    loadedAt: new Date().toISOString(),
    usage,
    rows: rowsWithPrints,
    pageInfo,
    printToken: signPrintToken(session.shop),
    // Without read_all_orders Shopify only returns the last 60 days.
    allOrdersAccess: (session.scope ?? "").split(",").includes("read_all_orders"),
    // What this plan actually prints (a locked saved default falls back).
    defaultTemplate: planSlipOptions(slipOptions(shop), shop.plan).template as SlipTemplate,
    plan: {
      templates: plan.templates,
      orderViews: plan.orderViews,
      customerList: plan.customerList,
    },
    viewsPlans: plansWith((p) => p.orderViews.length > 1),
    customerListPlans: plansWith((p) => p.customerList),
  };
};

/** Faded cell content for orders whose slip was already printed. */
const Dim = ({ on, children }: { on: boolean; children: React.ReactNode }) =>
  on ? <span style={{ opacity: 0.5 }}>{children}</span> : <>{children}</>;

/** "14th Oct 2026, 4:11 pm" in the merchant's browser time. */
const printedWhen = (iso: string) => {
  const d = new Date(iso);
  const day = d.getDate();
  const suffix =
    day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  const month = d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
  return `${day}${suffix} ${month}, ${time}`;
};

/** Short badge ("3 Printed"); every print date is in its tooltip. */
function PrintedBadge({ id, printed }: { id: string; printed: { count: number; dates: string[] } }) {
  const tip = `printed-${id}`;
  const older = printed.count - printed.dates.length;
  return (
    <>
      <s-clickable interestFor={tip} accessibilityLabel={`Printed ${printed.count} times — show dates`}>
        <s-badge tone="success">{`${printed.count} Printed`}</s-badge>
      </s-clickable>
      <s-tooltip id={tip}>
        {printed.dates.map((d) => (
          <s-paragraph key={d}>{printedWhen(d)}</s-paragraph>
        ))}
        {older > 0 && <s-paragraph>{`+ ${older} earlier`}</s-paragraph>}
      </s-tooltip>
    </>
  );
}

export default function Orders() {
  const {
    view,
    readyOnly,
    ready,
    search,
    range,
    perPage,
    loadedAt,
    rows,
    pageInfo,
    printToken,
    defaultTemplate,
    allOrdersAccess,
    usage,
    plan,
    viewsPlans,
    customerListPlans,
  } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
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

  // New orders appear on their own: re-run the loader every 30s while the
  // tab is visible and on the first page (later pages would shift under
  // the merchant). The selection survives a refresh.
  const onFirstPage = !pageInfo.hasPreviousPage;
  useEffect(() => {
    if (!onFirstPage) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [onFirstPage, revalidator]);
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

      <UsageBanner usage={usage} />

      {rows.length > 0 && rows.every((r) => !r.customer) && rows.some((r) => r.destination) && (
        // Orders have a city but never a name: Shopify is withholding
        // protected customer fields (it returns them empty, not an error).
        <s-banner tone="warning" heading="Customer names and addresses are hidden by Shopify">
          Shopify only shares names, street addresses and phone numbers with Weather Slip once
          protected customer data access is saved for the app. In the Partner Dashboard open
          Weather-Slip → API access requests → Protected customer data access, and under
          &quot;Protected customer fields&quot; select Name, Address and Phone (and Email if you
          want it), tick a reason for each and click Save. Then reload this page.
        </s-banner>
      )}

      {plan.orderViews.length === 1 && (
        <s-banner tone="info">
          Your plan lists unfulfilled and partially fulfilled orders. Fulfilled, unpaid, cancelled
          and archived orders are on {viewsPlans} — <s-link href="/app/plans">see plans</s-link>.
        </s-banner>
      )}

      {!allOrdersAccess && (
        <s-banner tone="info">
          Showing orders from the last 60 days. Shopify shows apps older orders only once
          &quot;Read all orders&quot; access is approved for Weather Slip.
        </s-banner>
      )}

      {ready.length > 0 && (
        // Flow can't print by itself (browsers only print from an open
        // page), so what it saved waits here for one click.
        <s-banner
          tone="success"
          heading={`${ready.length} order${ready.length === 1 ? "" : "s"} ready to print`}
        >
          Shopify Flow saved the weather on {ready.length === 1 ? "this order" : "these orders"}.
          Print {ready.length === 1 ? "its slip" : "all their slips"} in one go — each order uses
          one print from your plan.
          {ready.length > MAX_PRINT_ORDERS && ` The first ${MAX_PRINT_ORDERS} print now; the rest stay here.`}
          <s-button
            slot="secondary-actions"
            variant="primary"
            onClick={() => openPrint("slips", ready.slice(0, MAX_PRINT_ORDERS))}
          >
            {`Print ${ready.length === 1 ? "it" : `${Math.min(ready.length, MAX_PRINT_ORDERS)} slips`}`}
          </s-button>
          <s-button
            slot="secondary-actions"
            onClick={() => update({ ready: readyOnly ? null : "1", after: null, before: null })}
          >
            {readyOnly ? "Show all orders" : "Show them"}
          </s-button>
        </s-banner>
      )}

      {tooMany && (
        <s-banner tone="warning">
          You can print up to {MAX_PRINT_ORDERS} orders at a time — {selected.size} are selected.
        </s-banner>
      )}

      <s-section padding="none">
        <s-table
          paginate={pageInfo.hasNextPage || pageInfo.hasPreviousPage}
          hasNextPage={pageInfo.hasNextPage}
          hasPreviousPage={pageInfo.hasPreviousPage}
          loading={loading}
          onNextPage={() => update({ after: pageInfo.endCursor, before: null })}
          onPreviousPage={() => update({ before: pageInfo.startCursor, after: null })}
        >
          {/* Filters stay visible; while orders are selected the bulk actions
              sit above them as their own row (they used to replace the filters,
              and the template picker stretched across the bar). */}
          <div slot="filters" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {selected.size > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <s-text type="strong">{selected.size} selected</s-text>
                <div style={{ width: 240 }}>
                  <s-select
                    label="Slip template"
                    labelAccessibilityVisibility="exclusive"
                    value={template}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      if (isSlipTemplate(v)) setTemplate(v);
                    }}
                  >
                    {SLIP_TEMPLATES.map((t) => {
                      const locked = !plan.templates.includes(t.id);
                      return (
                        <s-option key={t.id} value={t.id} disabled={locked}>
                          {t.name}
                          {t.id === defaultTemplate ? " (default)" : ""}
                          {locked ? ` — ${PLANS[templatePlan(t.id)].name} plan` : ""}
                        </s-option>
                      );
                    })}
                  </s-select>
                </div>
                <s-button
                  variant="primary"
                  disabled={tooMany}
                  onClick={() => openPrint("slips", selectedIds)}
                >
                  Print packing slips
                </s-button>
                <s-button
                  disabled={tooMany || !plan.customerList}
                  onClick={() => openPrint("customers", selectedIds)}
                  {...(!plan.customerList
                    ? { accessibilityLabel: `Print customer list — on ${customerListPlans}` }
                    : {})}
                >
                  {plan.customerList ? "Print customer list" : "Customer list (Starter+)"}
                </s-button>
                <s-button variant="tertiary" onClick={() => setSelected(new Map())}>
                  Clear
                </s-button>
              </div>
            )}
            {/* One row like Shopify's: view picker, search filling the rest,
                date. Plain CSS grid — s-grid's container-query columns never
                applied inside the table's filter slot. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "140px minmax(0, 1fr) 160px 130px",
                gap: 8,
                alignItems: "center",
              }}
            >
              <s-select
                label="View"
                labelAccessibilityVisibility="exclusive"
                value={view}
                onChange={(e) => update({ view: e.currentTarget.value, after: null, before: null })}
              >
                {ORDER_VIEWS.map((v) => {
                  const locked = !plan.orderViews.includes(v.id);
                  return (
                    <s-option key={v.id} value={v.id} disabled={locked}>
                      {v.label}
                      {locked ? " — Pro plan" : ""}
                    </s-option>
                  );
                })}
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
              <s-select
                label="Orders per page"
                labelAccessibilityVisibility="exclusive"
                value={String(perPage)}
                onChange={(e) =>
                  update({
                    per: e.currentTarget.value === String(DEFAULT_PAGE_SIZE) ? null : e.currentTarget.value,
                    after: null,
                    before: null,
                  })
                }
              >
                {PAGE_SIZES.map((n) => (
                  <s-option key={n} value={String(n)}>
                    {n} per page
                  </s-option>
                ))}
              </s-select>
            </div>
          </div>

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
            <s-table-header>Packing slip</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {rows.map((r) => {
              const pay = r.financialStatus ? PAYMENT[r.financialStatus] : null;
              const ful = FULFILLMENT[r.fulfillmentStatus];
              const dim = r.printed != null;
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
                    <Dim on={dim}>
                      <s-link href={`shopify://admin/orders/${r.id}`}>{r.name}</s-link>
                    </Dim>
                  </s-table-cell>
                  <s-table-cell><Dim on={dim}>{orderDate(r.createdAt)}</Dim></s-table-cell>
                  <s-table-cell><Dim on={dim}>{r.customer ?? "No customer"}</Dim></s-table-cell>
                  <s-table-cell><Dim on={dim}>{r.channel ?? ""}</Dim></s-table-cell>
                  <s-table-cell>
                    <Dim on={dim}>
                      {new Intl.NumberFormat(undefined, {
                        style: "currency",
                        currency: r.currency,
                      }).format(Number(r.total))}
                    </Dim>
                  </s-table-cell>
                  <s-table-cell>
                    <Dim on={dim}>
                      {r.financialStatus && (
                        <s-badge tone={pay?.tone ?? "neutral"}>
                          {pay?.label ?? humanise(r.financialStatus)}
                        </s-badge>
                      )}
                    </Dim>
                  </s-table-cell>
                  <s-table-cell>
                    <Dim on={dim}>
                      <s-stack direction="inline" gap="small-200">
                        {r.cancelled && <s-badge tone="critical">Cancelled</s-badge>}
                        <s-badge tone={ful?.tone ?? "neutral"}>
                          {ful?.label ?? humanise(r.fulfillmentStatus)}
                        </s-badge>
                      </s-stack>
                    </Dim>
                  </s-table-cell>
                  <s-table-cell>
                    <Dim on={dim}>
                      {r.itemCount} {r.itemCount === 1 ? "item" : "items"}
                    </Dim>
                  </s-table-cell>
                  <s-table-cell><Dim on={dim}>{r.shippingMethod ?? ""}</Dim></s-table-cell>
                  <s-table-cell>
                    {/* Printed before: the row is dimmed and the action says
                        Reprint (same saved forecast; it still uses a print). */}
                    <s-stack direction="block" gap="small-100">
                      <s-button
                        icon="print"
                        variant={dim ? "tertiary" : "secondary"}
                        onClick={() => openPrint("slips", [r.id])}
                        accessibilityLabel={dim ? `Reprint packing slip for ${r.name}` : `Print packing slip for ${r.name}`}
                      >
                        {dim ? "Reprint" : "Print slip"}
                      </s-button>
                      {r.printed && <PrintedBadge id={r.id} printed={r.printed} />}
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              );
            })}
          </s-table-body>
        </s-table>
        {rows.length > 0 && (
          <div style={{ padding: "8px 16px", borderTop: "1px solid #ebebeb" }}>
            <s-text color="subdued">
              {rows.length} {rows.length === 1 ? "order" : "orders"} shown
              {onFirstPage
                ? ` · updates automatically · last checked ${new Date(loadedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                : ""}
            </s-text>
          </div>
        )}
        {rows.length === 0 && !loading && (
          // Empty state, like Shopify's Orders page.
          <div style={{ padding: "48px 16px 56px", textAlign: "center" }}>
            <svg width="64" height="64" viewBox="0 0 24 24" aria-hidden="true" style={{ marginBottom: 12 }}>
              <path
                d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z"
                fill="#f1f1f1"
                stroke="#8a8a8a"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
              <path d="M4 7.5 12 12l8-4.5M12 12v9" fill="none" stroke="#8a8a8a" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            <div style={{ fontSize: 16, fontWeight: 650, marginBottom: 4 }}>
              {search || view !== "all" || range !== "any" ? "No orders found" : "No orders yet"}
            </div>
            <s-text color="subdued">
              {search || view !== "all" || range !== "any"
                ? "Try changing the filters or search term."
                : allOrdersAccess
                  ? "Orders will appear here as customers buy from your store."
                  : "Shopify shows apps only the last 60 days of orders until “Read all orders” access is approved."}
            </s-text>
            {(search || view !== "all" || range !== "any") && (
              <div style={{ marginTop: 12 }}>
                <s-button
                  onClick={() => {
                    setQuery("");
                    update({ q: null, view: null, range: null, after: null, before: null });
                  }}
                >
                  Clear filters
                </s-button>
              </div>
            )}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
