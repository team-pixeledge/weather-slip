import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { adminPrintResponse } from "../lib/print-route.server";

// Document for the "Weather slip" print action in Shopify's Orders section
// (extensions/weather-slip-print*). The admin requests it with a session
// token, so the shop comes from authenticate.admin, not the URL.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, cors } = await authenticate.admin(request);
  return cors(await adminPrintResponse(session.shop, new URL(request.url)));
};
