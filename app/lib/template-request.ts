// "Build a template for my brand" requests (Business plan). Pure validation,
// shared by the Packing slip page and its action; the server side is in
// template-request.server.ts.

export const TEMPLATE_REQUEST_LIMITS = {
  descriptionMin: 20,
  descriptionMax: 2000,
  urlMax: 500,
  emailMax: 254,
  /** Requests a shop may send per window. */
  perWindow: 3,
  windowDays: 30,
} as const;

export interface TemplateRequestInput {
  description: string;
  referenceUrl: string | null;
  contactEmail: string;
}

export function parseTemplateRequest(
  raw: unknown,
): { ok: true; data: TemplateRequestInput } | { ok: false; error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const L = TEMPLATE_REQUEST_LIMITS;
  const description = typeof r.description === "string" ? r.description.trim() : "";
  if (description.length < L.descriptionMin) {
    return { ok: false, error: `Tell us a bit more about the template (at least ${L.descriptionMin} characters).` };
  }
  if (description.length > L.descriptionMax) {
    return { ok: false, error: `Keep the description under ${L.descriptionMax} characters.` };
  }
  const url = typeof r.referenceUrl === "string" ? r.referenceUrl.trim() : "";
  if (url && (url.length > L.urlMax || !/^https:\/\/[^\s"'<>]+$/i.test(url))) {
    return { ok: false, error: "The reference link must start with https://." };
  }
  const email = typeof r.contactEmail === "string" ? r.contactEmail.trim() : "";
  if (!email || email.length > L.emailMax || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter an email address we can reply to." };
  }
  return { ok: true, data: { description, referenceUrl: url || null, contactEmail: email } };
}

export const TEMPLATE_REQUEST_STATUS_LABEL: Record<string, string> = {
  RECEIVED: "Received",
  IN_PROGRESS: "In progress",
  DONE: "Ready",
  DECLINED: "Declined",
};
