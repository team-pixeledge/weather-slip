import * as Sentry from "@sentry/node";

// Error tracking (sentry.io, org thepixeledge, project weather-slip). On only
// where SENTRY_DSN is set — AWS production; Vercel staging and local dev
// leave it unset, so nothing is sent from there. Errors only: no tracing.
//
// Protected customer data: slips print names, addresses and phones, so an
// event must never carry request bodies, headers, cookies, query strings or
// user data. Order IDs and the shop domain are fine.

let started = false;

export function initSentry(component: "web" | "worker"): void {
  const dsn = process.env.SENTRY_DSN;
  if (started || !dsn) return;
  started = true;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || "production",
    release: process.env.SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    includeLocalVariables: false,
    tracesSampleRate: 0,
    initialScope: { tags: { component } },
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
        if (event.request.url) event.request.url = event.request.url.split("?")[0];
      }
      delete event.user;
      return event;
    },
    // Console lines can quote Shopify responses; keep only outbound HTTP
    // breadcrumbs, without their query strings.
    beforeBreadcrumb(crumb) {
      if (crumb.category !== "http") return null;
      if (typeof crumb.data?.url === "string") crumb.data.url = crumb.data.url.split("?")[0];
      return crumb;
    },
  });
}

/** Report an error with optional non-personal context (ids, paths, reasons). */
export function captureError(err: unknown, context?: Record<string, string | number | undefined>): void {
  if (!started) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

/** Wait for queued events to be sent, e.g. before the worker exits. */
export function flushSentry(timeoutMs = 2000): Promise<boolean> {
  return started ? Sentry.flush(timeoutMs) : Promise.resolve(true);
}
