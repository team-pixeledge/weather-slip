import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { localDate } from "../lib/dates";
import { ensureShop, slipOptions } from "../lib/shop.server";
import {
  FOOTER_MAX,
  isSlipTemplate,
  renderPackingSlips,
  SLIP_TEMPLATES,
  type SlipOptions,
} from "../lib/slip";
import { sampleSlipData } from "../lib/slip-sample";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  return {
    options: slipOptions(shop),
    unit: shop.unit,
    today: localDate(new Date(), shop.timezone),
    shopName: session.shop.replace(/\.myshopify\.com$/, ""),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const body = (await request.json()) as Record<string, unknown>;
  // Whitelisted fields only — never pass the body to Prisma.
  const footer =
    typeof body.footer === "string" ? body.footer.slice(0, FOOTER_MAX) : null;
  await prisma.shop.update({
    where: { shop: session.shop },
    data: {
      slipTemplate: isSlipTemplate(body.template) ? body.template : "CLASSIC",
      slipPaper: body.paper === "LETTER" ? "LETTER" : "A4",
      slipShowImages: body.showImages === true,
      slipShowSku: body.showSku === true,
      slipShowBilling: body.showBilling === true,
      slipShowNote: body.showNote === true,
      slipFooter: footer,
    },
  });
  return { ok: true };
};

const DEFAULT_THANKS = "Thank you for shopping with us!";

export default function PackingSlip() {
  const loaded = useLoaderData<typeof loader>();
  const [o, setO] = useState<SlipOptions>(loaded.options);
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Packing slip saved");
  }, [fetcher.data, shopify]);

  const preview = useMemo(() => {
    const { shop, order, weather } = sampleSlipData(loaded.today, loaded.shopName);
    return renderPackingSlips(shop, [order], weather, {
      unit: loaded.unit,
      timeZone: "UTC",
      nonce: "preview",
      chrome: false,
      autoPrint: false,
      slip: o,
    });
  }, [o, loaded.today, loaded.shopName, loaded.unit]);

  const isLabel = o.template === "LABEL_4X6";
  const toggle = (key: "showImages" | "showSku" | "showBilling" | "showNote", label: string, disabled = false) => (
    <s-checkbox
      label={label}
      checked={o[key]}
      disabled={disabled}
      onChange={(e) => setO({ ...o, [key]: e.currentTarget.checked })}
    />
  );

  return (
    <s-page heading="Packing slip" inlineSize="large">
      <s-button
        slot="primary-action"
        onClick={() => fetcher.submit({ ...o }, { method: "POST", encType: "application/json" })}
        {...(fetcher.state !== "idle" ? { loading: true } : {})}
      >
        Save
      </s-button>
      <s-button slot="secondary-actions" href="/app/orders">
        Print from Orders
      </s-button>

      <s-section heading="Template">
        <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr 1fr 1fr, 1fr 1fr" gap="base">
          {SLIP_TEMPLATES.map((t) => {
            const selected = o.template === t.id;
            return (
              <s-clickable
                key={t.id}
                padding="base"
                borderRadius="base"
                borderWidth={selected ? "large" : "base"}
                borderColor={selected ? "strong" : "base"}
                background={selected ? "subdued" : "base"}
                accessibilityLabel={`${t.name} template${selected ? " (selected)" : ""}`}
                onClick={() => setO({ ...o, template: t.id })}
              >
                <s-stack direction="block" gap="small-200">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-text type="strong">{t.name}</s-text>
                    {selected && <s-badge tone="success">Selected</s-badge>}
                  </s-stack>
                  <s-text color="subdued">{t.description}</s-text>
                </s-stack>
              </s-clickable>
            );
          })}
        </s-grid>
      </s-section>

      <s-section heading="Preview">
        <s-box borderWidth="base" borderRadius="base" overflow="hidden" background="subdued">
          <iframe
            title="Packing slip preview"
            srcDoc={preview}
            sandbox=""
            style={{
              display: "block",
              border: 0,
              width: "100%",
              height: isLabel ? 720 : 1000,
              background: "#f3f3f3",
            }}
          />
        </s-box>
        <s-paragraph>
          Sample order with a sample forecast. Real slips use each order&apos;s
          destination forecast at print time.
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Options">
        <s-stack direction="block" gap="base">
          <s-select
            label="Paper size"
            value={o.paper}
            disabled={isLabel}
            details={isLabel ? "Labels always print at 4×6 in." : undefined}
            onChange={(e) => setO({ ...o, paper: e.currentTarget.value === "LETTER" ? "LETTER" : "A4" })}
          >
            <s-option value="A4">A4</s-option>
            <s-option value="LETTER">US Letter</s-option>
          </s-select>
          {toggle("showImages", "Product images", o.template === "MINIMAL" || isLabel)}
          {toggle("showSku", "SKUs")}
          {toggle("showBilling", "Bill-to address", isLabel)}
          {toggle("showNote", "Order note")}
          <s-text-area
            label="Footer message"
            details="Shown at the bottom of every slip. Leave empty for no message."
            rows={2}
            maxLength={FOOTER_MAX}
            value={o.footer ?? DEFAULT_THANKS}
            onInput={(e) => setO({ ...o, footer: e.currentTarget.value })}
          />
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Printing">
        <s-paragraph>
          Print one slip or many from <s-link href="/app/orders">Orders</s-link>:
          select orders, then Print packing slips. You can pick a different
          template there for a single print.
        </s-paragraph>
        <s-paragraph>
          Prefer Shopify&apos;s own packing slip or Order Printer? Add the
          weather to them in{" "}
          <s-link href="/app/snippets">Shopify templates</s-link>.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
