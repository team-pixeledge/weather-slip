// Shared by the Orders page (client) and orders.server.ts.

// Same tabs as Shopify's own Orders page, so the list reads familiarly.
export type OrderView = "all" | "unfulfilled" | "unpaid" | "open" | "archived";

export const ORDER_VIEWS: { id: OrderView; label: string; filter: string }[] = [
  // Every order, any status or age (orders older than 60 days need the
  // read_all_orders scope).
  { id: "all", label: "All", filter: "" },
  {
    id: "unfulfilled",
    label: "Unfulfilled",
    filter: "status:open AND (fulfillment_status:unfulfilled OR fulfillment_status:partial)",
  },
  {
    id: "unpaid",
    label: "Unpaid",
    filter:
      "(financial_status:pending OR financial_status:authorized OR financial_status:partially_paid OR financial_status:expired)",
  },
  { id: "open", label: "Open", filter: "status:open" },
  { id: "archived", label: "Archived", filter: "status:closed" },
];

export type OrderRange = "any" | "30" | "60" | "180" | "365";

export const ORDER_RANGES: { id: OrderRange; label: string }[] = [
  { id: "any", label: "Any time" },
  { id: "30", label: "Last 30 days" },
  { id: "60", label: "Last 60 days" },
  { id: "180", label: "Last 180 days" },
  { id: "365", label: "Last 12 months" },
];

export const MAX_PRINT_ORDERS = 50;
