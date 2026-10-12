import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";

// The old Overview page is merged into Plans & pricing (usage) and Orders
// (per-order weather status); opening the app lands on Orders.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  // Keep the embedded-app params (host, shop, …) on the way through.
  throw redirect(`/app/orders${url.search}`);
};
