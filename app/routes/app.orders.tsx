import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

// Orders is the app's home page (/app) now; keep old /app/orders links working.
export const loader = ({ request }: LoaderFunctionArgs) => {
  throw redirect(`/app${new URL(request.url).search}`);
};
