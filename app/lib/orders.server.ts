// Live order reads for the Orders page and the print views. Customer name,
// street address and phone are read from Shopify at print time and only
// rendered — never stored (Level 2 protected customer data).

import { MAX_PRINT_ORDERS, ORDER_VIEWS, type OrderRange, type OrderView } from "./order-views";

export interface GraphqlClient {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<Response>;
}

/**
 * Run a query, keeping partial data. Shopify answers a field the app may
 * not read (e.g. a customer name before protected-data access is approved)
 * with null plus an error; the client library throws on that, but the rest
 * of the order is still good to show.
 */
export async function query<T>(
  admin: GraphqlClient,
  q: string,
  variables: Record<string, unknown>,
): Promise<T> {
  try {
    const res = await admin.graphql(q, { variables });
    const json = (await res.json()) as { data?: T; errors?: unknown };
    if (!json.data) throw new Error(`Order query failed: ${JSON.stringify(json.errors)}`);
    return json.data;
  } catch (err) {
    const partial = (err as { body?: { data?: T | null } }).body?.data;
    if (partial) {
      console.warn("[orders] partial data:", err instanceof Error ? err.message : err);
      return partial;
    }
    throw err;
  }
}

// ---------- list ----------

export function orderSearchQuery(
  view: OrderView,
  search: string,
  range: OrderRange = "any",
  now = new Date(),
): string {
  const parts: string[] = [];
  const base = (ORDER_VIEWS.find((v) => v.id === view) ?? ORDER_VIEWS[0]!).filter;
  if (base) parts.push(base);
  if (range !== "any") {
    const since = new Date(now.getTime() - Number(range) * 86_400_000).toISOString().slice(0, 10);
    parts.push(`created_at:>=${since}`);
  }
  const s = search.trim();
  // Parenthesised so a typed "OR" can't widen the view's filter.
  if (s) parts.push(`(${s})`);
  return parts.join(" AND ");
}

const LIST_QUERY = `#graphql
  query OrdersForSlips(
    $first: Int
    $after: String
    $last: Int
    $before: String
    $query: String
  ) {
    orders(
      first: $first
      after: $after
      last: $last
      before: $before
      query: $query
      sortKey: CREATED_AT
      reverse: true
    ) {
      nodes {
        id
        name
        createdAt
        displayFinancialStatus
        displayFulfillmentStatus
        currentSubtotalLineItemsQuantity
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingAddress { name city provinceCode countryCodeV2 }
        billingAddress { name }
        shippingLine { title }
        tags
        app { name }
        sourceName
      }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }`;

interface ListData {
  orders: {
    nodes: {
      id: string;
      name: string;
      createdAt: string;
      displayFinancialStatus: string | null;
      displayFulfillmentStatus: string;
      currentSubtotalLineItemsQuantity: number;
      totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
      shippingAddress: {
        name: string | null;
        city: string | null;
        provinceCode: string | null;
        countryCodeV2: string | null;
      } | null;
      billingAddress: { name: string | null } | null;
      shippingLine: { title: string } | null;
      tags: string[];
      app: { name: string } | null;
      sourceName: string | null;
    }[];
    pageInfo: {
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      startCursor: string | null;
      endCursor: string | null;
    };
  };
}

export interface OrderRow {
  id: string; // numeric
  name: string;
  createdAt: string;
  customer: string | null;
  destination: string | null;
  itemCount: number;
  total: string;
  currency: string;
  financialStatus: string | null;
  fulfillmentStatus: string;
  shippingMethod: string | null;
  channel: string | null;
  tags: string[];
}

export const numericId = (gid: string) => gid.slice(gid.lastIndexOf("/") + 1);

export async function listOrders(
  admin: GraphqlClient,
  opts: {
    view: OrderView;
    search: string;
    range?: OrderRange;
    after?: string | null;
    before?: string | null;
    pageSize?: number;
  },
) {
  const size = opts.pageSize ?? 25;
  const data = await query<ListData>(admin, LIST_QUERY, {
    query: orderSearchQuery(opts.view, opts.search, opts.range) || null,
    ...(opts.before ? { last: size, before: opts.before } : { first: size, after: opts.after ?? null }),
  });
  const rows: OrderRow[] = data.orders.nodes.map((o) => {
    const a = o.shippingAddress;
    return {
      id: numericId(o.id),
      name: o.name,
      createdAt: o.createdAt,
      customer: a?.name || o.billingAddress?.name || null,
      destination: a
        ? [a.city, a.provinceCode, a.countryCodeV2].filter(Boolean).join(", ") || null
        : null,
      itemCount: o.currentSubtotalLineItemsQuantity,
      total: o.totalPriceSet.shopMoney.amount,
      currency: o.totalPriceSet.shopMoney.currencyCode,
      financialStatus: o.displayFinancialStatus,
      fulfillmentStatus: o.displayFulfillmentStatus,
      shippingMethod: o.shippingLine?.title ?? null,
      channel: o.app?.name ?? o.sourceName ?? null,
      tags: o.tags,
    };
  });
  return { rows, pageInfo: data.orders.pageInfo };
}

// ---------- print ----------

const PRINT_QUERY = `#graphql
  query OrdersToPrint($ids: [ID!]!) {
    shop {
      name
      contactEmail
      ianaTimezone
      primaryDomain { host }
      shopAddress { address1 address2 city province zip country }
    }
    nodes(ids: $ids) {
      ... on Order {
        id
        name
        createdAt
        note
        phone
        email
        displayFinancialStatus
        displayFulfillmentStatus
        shippingLine { title }
        shippingAddress {
          name company address1 address2 city province provinceCode zip
          country countryCodeV2 phone latitude longitude
        }
        billingAddress {
          name company address1 address2 city province zip country phone
        }
        fulfillments(first: 5) { createdAt estimatedDeliveryAt }
        savedForecast: metafield(namespace: "weather_slip", key: "forecast") { value }
        currencyCode
        currentSubtotalPriceSet { shopMoney { amount } }
        currentTotalDiscountsSet { shopMoney { amount } }
        totalShippingPriceSet { shopMoney { amount } }
        currentTotalTaxSet { shopMoney { amount } }
        currentTotalPriceSet { shopMoney { amount } }
        lineItems(first: 100) {
          nodes {
            id
            name
            sku
            variantTitle
            quantity
            unfulfilledQuantity
            originalUnitPriceSet { shopMoney { amount } }
            image { url(transform: { maxWidth: 160, maxHeight: 160 }) altText }
          }
        }
      }
    }
  }`;

export interface PrintAddress {
  name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  provinceCode?: string | null;
  zip?: string | null;
  country?: string | null;
  countryCodeV2?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface PrintLineItem {
  id: string;
  name: string;
  sku: string | null;
  variantTitle: string | null;
  quantity: number;
  unfulfilledQuantity: number;
  originalUnitPriceSet?: Money;
  image: { url: string; altText: string | null } | null;
}

interface Money {
  shopMoney: { amount: string };
}

export interface PrintOrder {
  id: string;
  name: string;
  createdAt: string;
  note: string | null;
  phone: string | null;
  /** Protected (Email field); null until that access is granted. */
  email?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus: string;
  shippingLine: { title: string } | null;
  shippingAddress: PrintAddress | null;
  billingAddress: PrintAddress | null;
  fulfillments: { createdAt: string; estimatedDeliveryAt: string | null }[];
  lineItems: { nodes: PrintLineItem[] };
  /** weather_slip.forecast: the slip forecast saved at the first print. */
  savedForecast?: { value: string } | null;
  // Prices for the Detailed template (not customer data).
  currencyCode?: string;
  currentSubtotalPriceSet?: Money;
  currentTotalDiscountsSet?: Money;
  totalShippingPriceSet?: Money;
  currentTotalTaxSet?: Money;
  currentTotalPriceSet?: Money;
}

export interface PrintShop {
  name: string;
  contactEmail: string | null;
  ianaTimezone: string;
  primaryDomain: { host: string } | null;
  shopAddress: PrintAddress | null;
}

/** Orders in the order the IDs were given (the merchant's selection order). */
export async function ordersToPrint(admin: GraphqlClient, orderIds: string[]) {
  const ids = orderIds.slice(0, MAX_PRINT_ORDERS).map((id) => `gid://shopify/Order/${id}`);
  const data = await query<{ shop: PrintShop; nodes: (PrintOrder | null)[] }>(
    admin,
    PRINT_QUERY,
    { ids },
  );
  const orders = data.nodes.filter((n): n is PrintOrder => n != null && "name" in n);
  return { shop: data.shop, orders };
}
