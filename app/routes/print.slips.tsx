import type { LoaderFunctionArgs } from "react-router";
import { printResponse } from "../lib/print-route.server";

// Opened in its own browser tab from the Orders page; authorised by the
// signed print token, not an embedded-app session.
export const loader = ({ request }: LoaderFunctionArgs) => printResponse(request, "slips");
