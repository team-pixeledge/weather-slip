import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

// No "type your shop domain" form: Shopify App Store apps must not ask
// merchants for their myshopify.com address, and reviewers open the app URL
// directly. Merchants arrive from the App Store or their Shopify admin, which
// always pass ?shop= — that still goes through login() to OAuth. Anyone else
// gets a pointer to the App Store instead of a form.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop) return { invalidShop: false };
  // Redirects to Shopify's install/OAuth flow when the shop is valid.
  const errors = loginErrorMessage(await login(request));
  return { invalidShop: Boolean(errors.shop) };
};

export default function Auth() {
  const { invalidShop } = useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: 520, margin: "80px auto", padding: "0 16px", font: "16px/1.6 system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, margin: "0 0 12px" }}>Weather Slip</h1>
      <p>
        {invalidShop
          ? "That store address isn’t valid. Open Weather Slip from your Shopify admin (Apps → Weather Slip)."
          : "Weather Slip runs inside your Shopify admin. Install it from the Shopify App Store, or open it from Apps → Weather Slip in your Shopify admin."}
      </p>
      <p>
        <a href="https://thepixeledge.in/weather-slip/">About Weather Slip</a>
        {" · "}
        <a href="/privacy">Privacy policy</a>
      </p>
    </main>
  );
}
