import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { runInBackground } from "../lib/background.server";
import { enqueue } from "../lib/jobs.server";
import { PLANS } from "../lib/plans";
import { drainQueue } from "../lib/queue-runner.server";
import { ensureShop } from "../lib/shop.server";

const STATUS_LABEL: Record<string, string> = {
  OK: "Saved",
  PENDING_DATES: "Waiting for forecast",
  NO_LOCATION: "No shipping address",
  LIMIT_REACHED: "Plan limit reached",
  FAILED: "Failed",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  // Latest version per order, newest orders first.
  const rows = await prisma.$queryRaw<
    {
      orderId: string;
      orderName: string;
      version: number;
      status: string;
      summary: string | null;
      frozenAt: Date | null;
      createdAt: Date;
    }[]
  >`
    SELECT DISTINCT ON ("orderId") "orderId", "orderName", version, status, summary, "frozenAt", "createdAt"
      FROM "OrderWeatherSnapshot"
     WHERE shop = ${session.shop}
     ORDER BY "orderId", version DESC`;
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const failedJobs = await prisma.weatherJob.count({
    where: { shop: session.shop, status: "FAILED" },
  });

  return {
    plan: PLANS[shop.plan],
    usage: shop.usageCount,
    periodStart: shop.usagePeriodStart.toISOString(),
    recent: rows.slice(0, 25).map((r) => ({
      ...r,
      frozen: r.frozenAt != null,
      createdAt: r.createdAt.toISOString(),
    })),
    failedJobs,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const orderId = String(form.get("orderId") ?? "");
  // Only orders this shop already has a snapshot for can be refreshed.
  const owned = await prisma.orderWeatherSnapshot.findFirst({
    where: { shop: session.shop, orderId },
    select: { id: true },
  });
  if (!owned) return { ok: false };
  await enqueue(session.shop, orderId, "REFRESH");
  runInBackground(drainQueue({ budgetMs: 20_000 }));
  return { ok: true };
};

export default function Overview() {
  const { plan, usage, recent, failedJobs } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  return (
    <s-page heading="Weather Slip">
      <s-section heading="This month">
        <s-paragraph>
          {plan.name} plan · {usage} of {plan.ordersPerPeriod} orders printed with weather
        </s-paragraph>
        {failedJobs > 0 && (
          <s-banner tone="warning">
            {failedJobs} order(s) couldn&apos;t get weather after several retries.
          </s-banner>
        )}
      </s-section>

      <s-section heading="Recent orders">
        {recent.length === 0 ? (
          <s-paragraph>
            No orders with weather yet. Print packing slips from{" "}
            <s-link href="/app/orders">Orders</s-link> — each order counts once
            toward your plan the first time it&apos;s printed with weather, and
            the weather is then also saved for Shopify&apos;s own slip (see{" "}
            <s-link href="/app/snippets">Invoice &amp; slip setup</s-link>).
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Order</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Printed text</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {recent.map((r) => (
                <s-table-row key={r.orderId}>
                  <s-table-cell>{r.orderName}</s-table-cell>
                  <s-table-cell>
                    {STATUS_LABEL[r.status] ?? r.status}
                    {r.frozen ? " · shipped (locked)" : ""}
                  </s-table-cell>
                  <s-table-cell>{r.summary ?? "—"}</s-table-cell>
                  <s-table-cell>
                    <s-button
                      variant="tertiary"
                      onClick={() =>
                        fetcher.submit({ orderId: r.orderId }, { method: "POST" })
                      }
                    >
                      Refresh
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="How reprints work">
        <s-paragraph>
          Your plan counts orders, not weather lookups: an order counts the
          first time its slip is printed with weather, and reprints are free.
          The weather saved on the order then stays the same on every reprint
          of Shopify&apos;s own slip and locks when the order ships. Refresh
          replaces it on purpose (the earlier version is kept).
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
