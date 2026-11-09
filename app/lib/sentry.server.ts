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
    // A browser that navigates away mid-render breaks the response stream;
    // nothing failed on our side (React's onShellReady → pipe). Not an error.
    ignoreErrors: ["The destination stream errored while writing data"],
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

/**
 * Shopify's app library throws bare `Response` objects, not Errors — e.g.
 * `Response(500)` when refreshing an expiring offline token fails (it drops
 * the underlying error). Those stringify as "[object Response]" and reach
 * Sentry with no stack or status. Turn them into an Error naming the status;
 * the body is not read (it can quote Shopify payloads).
 */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (err instanceof Response) {
    const e = new Error(
      `Shopify library threw a Response: HTTP ${err.status}${err.statusText ? ` ${err.statusText}` : ""}` +
        (err.status === 500 && !err.body
          ? " (likely an offline access-token refresh failure)"
          : ""),
    );
    e.name = "ShopifyResponseError";
    return e;
  }
  return new Error(String(err));
}

/** Human-readable message for logs and stored job errors. */
export function errorMessage(err: unknown): string {
  return toError(err).message;
}

/** Report an error with optional non-personal context (ids, paths, reasons). */
export function captureError(err: unknown, context?: Record<string, string | number | undefined>): void {
  if (!started) return;
  const extra = { ...context, ...(err instanceof Response ? { httpStatus: err.status } : {}) };
  Sentry.captureException(toError(err), Object.keys(extra).length ? { extra } : undefined);
}

/** Wait for queued events to be sent, e.g. before the worker exits. */
export function flushSentry(timeoutMs = 2000): Promise<boolean> {
  return started ? Sentry.flush(timeoutMs) : Promise.resolve(true);
}
