// Pure helpers for the Shopify Flow "Save weather on order" action.

/** Numeric order id from a Flow payload's properties (number, string or gid). */
export function flowOrderId(payload: unknown): string | null {
  const props = (payload as { properties?: Record<string, unknown> } | null)?.properties;
  const raw = props?.order_id ?? props?.orderId;
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const s = String(raw);
  const id = s.slice(s.lastIndexOf("/") + 1);
  return /^\d{1,20}$/.test(id) ? id : null;
}

/** A 4xx Flow shows the merchant (it doesn't retry 4xx). */
export const flowFailure = (status: number, message: string) =>
  new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
