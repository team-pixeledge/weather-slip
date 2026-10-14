import prisma from "../db.server";
import { sendAlertEmail } from "./alerts.server";
import type { GraphqlClient } from "./orders.server";
import { PLANS, type PlanId } from "./plans";
import { parseTemplateRequest, TEMPLATE_REQUEST_LIMITS } from "./template-request";

/** The shop's own contact email, to pre-fill the request form. */
export async function shopContactEmail(admin: GraphqlClient): Promise<string | null> {
  try {
    const res = await admin.graphql(`#graphql
      query TemplateRequestContact { shop { email } }`);
    const json = (await res.json()) as { data?: { shop: { email: string | null } } };
    return json.data?.shop.email ?? null;
  } catch {
    return null;
  }
}

export function recentTemplateRequests(shop: string) {
  return prisma.templateRequest.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, description: true, status: true, createdAt: true },
  });
}

/**
 * Record a request and email the operator. Business plan only, at most
 * TEMPLATE_REQUEST_LIMITS.perWindow per window per shop.
 */
export async function submitTemplateRequest(
  shop: string,
  plan: PlanId,
  raw: unknown,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!PLANS[plan].customTemplateRequest) {
    return { ok: false, error: "Custom templates are part of the Business plan." };
  }
  const parsed = parseTemplateRequest(raw);
  if (!parsed.ok) return parsed;

  const L = TEMPLATE_REQUEST_LIMITS;
  const since = new Date(now.getTime() - L.windowDays * 86_400_000);
  const recent = await prisma.templateRequest.count({ where: { shop, createdAt: { gte: since } } });
  if (recent >= L.perWindow) {
    return {
      ok: false,
      error: `You've sent ${L.perWindow} requests in the last ${L.windowDays} days. We'll reply to those first — or email us to add to one.`,
    };
  }

  const row = await prisma.templateRequest.create({ data: { shop, ...parsed.data } });
  await sendAlertEmail(
    `New custom template request from ${shop}`,
    [
      `Shop: ${shop} (${PLANS[plan].name} plan)`,
      `Reply to: ${parsed.data.contactEmail}`,
      parsed.data.referenceUrl ? `Reference: ${parsed.data.referenceUrl}` : null,
      `Request id: ${row.id}`,
      "",
      parsed.data.description,
      "",
      `Update its status in the TemplateRequest table (RECEIVED → IN_PROGRESS → DONE / DECLINED); the merchant sees it on the Packing slip page.`,
    ]
      .filter((l) => l != null)
      .join("\n"),
  );
  return { ok: true };
}
