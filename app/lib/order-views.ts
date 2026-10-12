// Shared by the Orders page (client) and orders.server.ts.

export type OrderView = "unfulfilled" | "on_hold" | "open";

export const ORDER_VIEWS: { id: OrderView; label: string; filter: string }[] = [
  {
    id: "unfulfilled",
    label: "Unfulfilled",
    filter: "status:open AND (fulfillment_status:unfulfilled OR fulfillment_status:partial)",
  },
  { id: "on_hold", label: "On hold", filter: "status:open AND fulfillment_status:on_hold" },
  { id: "open", label: "All open", filter: "status:open" },
];

export const MAX_PRINT_ORDERS = 50;
