import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { notifyAdminLater } from "./lib/alerts.server";

/**
 * Unexpected errors from any loader/action/render → operator alert
 * (throttled per message). Aborted requests are the browser navigating
 * away, not breakage.
 */
export function handleError(error: unknown, { request }: { request: Request }) {
  if (request.signal.aborted) return;
  console.error(error);
  const msg = error instanceof Error ? error.message : String(error);
  const path = new URL(request.url).pathname;
  notifyAdminLater(
    `server-error:${path}:${msg.slice(0, 80)}`,
    `Server error on ${path}`,
    `${request.method} ${path}\n\n${error instanceof Error ? (error.stack ?? msg) : msg}`.slice(0, 4000),
  );
}

export const streamTimeout = 5000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? '')
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      }
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
