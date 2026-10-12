// Shared by the Orders page (client) and orders.server.ts.

export type OrderView = "unfulfilled" | "on_hold" | "open" | "fulfilled" | "all";

export const ORDER_VIEWS: { id: OrderView; label: string; filter: string }[] = [
  {
    id: "unfulfilled",
    label: "Unfulfilled",
    filter: "status:open AND (fulfillment_status:unfulfilled OR fulfillment_status:partial)",
  },
  { id: "on_hold", label: "On hold", filter: "status:open AND fulfillment_status:on_hold" },
  { id: "open", label: "All open", filter: "status:open" },
  { id: "fulfilled", label: "Fulfilled", filter: "fulfillment_status:fulfilled" },
  // Every order, any status or age (orders older than 60 days need the
  // read_all_orders scope).
  { id: "all", label: "All orders", filter: "" },
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
