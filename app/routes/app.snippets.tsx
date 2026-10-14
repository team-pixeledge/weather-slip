import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { METAFIELD_NAMESPACE, METAFIELD_SUMMARY_KEY } from "../lib/constants";
import { PLANS } from "../lib/plans";
import { ensureShop } from "../lib/shop.server";

const field = `order.metafields.${METAFIELD_NAMESPACE}.${METAFIELD_SUMMARY_KEY}`;

// No order-confirmation email target: weather is saved on an order when its
// slip is first printed in the app, long after that email goes out.
// The same one-line snippet works in each of these because they all expose
// order metafields to Liquid. Kept to the plain summary text: it's the
// lowest common denominator every renderer handles. The credit line is
// OpenWeather's licence (visible attribution wherever its data is shown).
const SNIPPET = `{% if ${field} != blank %}
  <p style="margin:8px 0;font-size:12px;">
    <strong>Destination weather:</strong> {{ ${field} }}
    <br><span style="font-size:9px;color:#888;">Weather data © OpenWeather</span>
  </p>
{% endif %}`;

const TARGETS = [
  {
    id: "packing-slip",
    title: "Shopify packing slip",
    paid: false,
    steps:
      "Settings → Shipping and delivery → Packing slips → Edit. Paste below the shipping address block and save. To check it, print a real order's packing slip — the editor's preview uses a sample order with no weather.",
  },
  {
    id: "order-printer",
    title: "Shopify Order Printer (invoices)",
    paid: true,
    steps: "Order Printer → Templates → your invoice → Edit. Paste where you want the line and save.",
  },
  {
    id: "order-printer-pro",
    title: "Order Printer Pro",
    paid: true,
    steps: "Templates → your invoice or packing slip → Edit code. Paste and save.",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  return { allTemplates: PLANS[shop.plan].allTemplates };
};

export default function Snippets() {
  const { allTemplates } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  const copy = async () => {
    await navigator.clipboard.writeText(SNIPPET);
    shopify.toast.show("Snippet copied");
  };

  return (
    <s-page heading="Shopify templates">
      <s-banner tone="info">
        Optional. The easiest way to print is right here in the app — from{" "}
        <s-link href="/app">Orders</s-link>, one slip or many, using
        the templates in <s-link href="/app/slip">Packing slip</s-link>. Use
        this page only if you&apos;d rather keep printing from Shopify&apos;s
        own packing slip, Order Printer or order emails.
      </s-banner>
      <s-paragraph>
        An order&apos;s weather is saved to it the first time you print its
        slip from the app; these templates then show that saved weather.
        Keep the &ldquo;Weather data © OpenWeather&rdquo; line: the weather
        data&apos;s licence requires it wherever the weather is shown.
      </s-paragraph>
      <s-section heading="The snippet">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            <code>{SNIPPET}</code>
          </pre>
        </s-box>
        <s-button onClick={copy}>Copy snippet</s-button>
      </s-section>

      {TARGETS.map((t) => (
        <s-section key={t.id} heading={t.title}>
          {t.paid && !allTemplates ? (
            <s-paragraph>Available on paid plans (Starter, Pro and Business).</s-paragraph>
          ) : (
            <s-paragraph>{t.steps}</s-paragraph>
          )}
        </s-section>
      ))}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
