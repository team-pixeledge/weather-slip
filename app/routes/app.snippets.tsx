import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { METAFIELD_NAMESPACE, METAFIELD_SUMMARY_KEY } from "../lib/constants";
import { PLANS } from "../lib/plans";
import { ensureShop } from "../lib/shop.server";

const field = `order.metafields.${METAFIELD_NAMESPACE}.${METAFIELD_SUMMARY_KEY}`;

// The same one-line snippet works in each of these because they all expose
// order metafields to Liquid. Kept to the plain summary text: it's the
// lowest common denominator every renderer handles.
const SNIPPET = `{% if ${field} != blank %}
  <p style="margin:8px 0;font-size:12px;">
    <strong>Destination weather:</strong> {{ ${field} }}
  </p>
{% endif %}`;

const TARGETS = [
  {
    id: "packing-slip",
    title: "Shopify packing slip",
    paid: false,
    steps: "Settings → Shipping and delivery → Packing slips → Edit. Paste below the shipping address block and save.",
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
  {
    id: "email",
    title: "Order confirmation email",
    paid: true,
    steps: "Settings → Notifications → Order confirmation → Edit code. Weather is usually ready a few seconds after the order, so it may be missing from emails sent instantly.",
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
    <s-page heading="Invoice & slip setup">
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
            <s-paragraph>Available on Starter and Pro.</s-paragraph>
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
