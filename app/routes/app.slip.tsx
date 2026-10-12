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
  FONT_SIZES,
  FONTS,
  FOOTER_MAX,
  isShopifyCdnUrl,
  PAPER_SIZES,
  isSlipTemplate,
  renderPackingSlips,
  sanitizeDesign,
  SLIP_TEMPLATES,
  TEXT_MAX,
  type FontKey,
  type PaperSize,
  type SlipDesign,
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
      slipPaper: PAPER_SIZES.some((p) => p.id === body.paper) ? (body.paper as PaperSize) : "A4",
      slipShowImages: body.showImages === true,
      slipShowSku: body.showSku === true,
      slipShowBilling: body.showBilling === true,
      slipShowNote: body.showNote === true,
      slipFooter: footer,
      slipDesign: { ...sanitizeDesign(body.design) },
    },
  });
  return { ok: true };
};

const DEFAULT_THANKS = "Thank you for shopping with us!";

type OptionKey = "showImages" | "showSku" | "showBilling" | "showNote";
type DesignFlag = {
  [K in keyof SlipDesign]: SlipDesign[K] extends boolean ? K : never;
}[keyof SlipDesign];

export default function PackingSlip() {
  const loaded = useLoaderData<typeof loader>();
  const [o, setO] = useState<SlipOptions>(loaded.options);
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const d = o.design;
  const setD = (patch: Partial<SlipDesign>) => setO({ ...o, design: { ...d, ...patch } });

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Packing slip saved");
  }, [fetcher.data, shopify]);

  // The preview uses what will actually be saved (e.g. a non-Shopify logo
  // link is dropped), so it never shows something the print won't.
  const previewOptions = useMemo(() => ({ ...o, design: sanitizeDesign(o.design) }), [o]);
  const preview = useMemo(() => {
    const { shop, order, weather } = sampleSlipData(loaded.today, loaded.shopName);
    return renderPackingSlips(shop, [order], weather, {
      unit: loaded.unit,
      timeZone: "UTC",
      nonce: "preview",
      chrome: false,
      autoPrint: false,
      slip: previewOptions,
    });
  }, [previewOptions, loaded.today, loaded.shopName, loaded.unit]);

  const isLabel = o.template === "LABEL_4X6";
  // Save stays faded until something differs from what's saved.
  const dirty = JSON.stringify(o) !== JSON.stringify(loaded.options);
  const logoInvalid = !!d.logoUrl && !isShopifyCdnUrl(d.logoUrl.trim());

  const opt = (key: OptionKey, label: string, disabled = false) => (
    <s-checkbox
      label={label}
      checked={o[key]}
      disabled={disabled}
      onChange={(e) => setO({ ...o, [key]: e.currentTarget.checked })}
    />
  );
  const flag = (key: DesignFlag, label: string, disabled = false) => (
    <s-checkbox
      label={label}
      checked={d[key]}
      disabled={disabled}
      onChange={(e) => setD({ [key]: e.currentTarget.checked } as Partial<SlipDesign>)}
    />
  );

  return (
    <s-page heading="Packing slip" inlineSize="large">
      <s-button
        slot="primary-action"
        onClick={() =>
          fetcher.submit(o as unknown as Parameters<typeof fetcher.submit>[0], {
            method: "POST",
            encType: "application/json",
          })
        }
        disabled={!dirty || logoInvalid}
        {...(fetcher.state !== "idle" ? { loading: true } : {})}
      >
        Save
      </s-button>
      <s-button slot="secondary-actions" href="/app">
        Print from Orders
      </s-button>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 32 }}>
        <s-section heading="Template">
          {/* One row of four (plain CSS grid — s-grid's container query
              didn't apply here and wrapped to two rows). */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
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
          </div>
        </s-section>

        {/* Settings on the left, live preview on the right (sticky). */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(300px, 380px) minmax(0, 1fr)",
            gap: 16,
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <s-section heading="Logo & header">
              <s-stack direction="block" gap="base">
                <s-text-field
                  label="Logo link"
                  placeholder="https://cdn.shopify.com/…"
                  details="Upload your logo in Shopify admin → Content → Files, then copy its link here."
                  value={d.logoUrl ?? ""}
                  error={
                    logoInvalid
                      ? "Use a link from Shopify Files (starts with https://cdn.shopify.com/)."
                      : undefined
                  }
                  onInput={(e) => setD({ logoUrl: e.currentTarget.value || null })}
                />
                <s-select
                  label="Logo position"
                  value={d.logoPosition}
                  disabled={!d.logoUrl}
                  onChange={(e) =>
                    setD({ logoPosition: e.currentTarget.value as SlipDesign["logoPosition"] })
                  }
                >
                  <s-option value="left">Left, beside the title</s-option>
                  <s-option value="center">Centre, above the title</s-option>
                  <s-option value="right">Right, above the order number</s-option>
                </s-select>
                <s-select
                  label="Logo size"
                  value={d.logoSize}
                  disabled={!d.logoUrl}
                  onChange={(e) => setD({ logoSize: e.currentTarget.value as SlipDesign["logoSize"] })}
                >
                  <s-option value="S">Small</s-option>
                  <s-option value="M">Medium</s-option>
                  <s-option value="L">Large</s-option>
                </s-select>
                <s-text-field
                  label="Title"
                  placeholder={o.template === "DETAILED" ? "Packing slip & receipt" : "Packing slip"}
                  maxLength={TEXT_MAX.title}
                  disabled={isLabel}
                  value={d.title ?? ""}
                  onInput={(e) => setD({ title: e.currentTarget.value || null })}
                />
                <s-text-area
                  label="Message at the top"
                  details="Optional, e.g. “Live plants — please open on arrival”."
                  rows={2}
                  maxLength={TEXT_MAX.headerNote}
                  value={d.headerNote ?? ""}
                  onInput={(e) => setD({ headerNote: e.currentTarget.value || null })}
                />
                {flag("showOrderDate", "Order date")}
                {flag("showShippingMethod", "Shipping method")}
              </s-stack>
            </s-section>

            <s-section heading="Customer & items">
              <s-stack direction="block" gap="base">
                {isLabel ? (
                  <s-select
                    label="Label size"
                    value={d.labelSize}
                    onChange={(e) =>
                      setD({ labelSize: e.currentTarget.value === "4x4" ? "4x4" : "4x6" })
                    }
                  >
                    <s-option value="4x6">4 × 6 in (100 × 150 mm)</s-option>
                    <s-option value="4x4">4 × 4 in (100 × 100 mm)</s-option>
                  </s-select>
                ) : (
                  <s-select
                    label="Paper size"
                    value={o.paper}
                    onChange={(e) => setO({ ...o, paper: e.currentTarget.value as PaperSize })}
                  >
                    {PAPER_SIZES.map((p) => (
                      <s-option key={p.id} value={p.id}>
                        {p.label}
                      </s-option>
                    ))}
                  </s-select>
                )}
                {opt("showBilling", "Bill-to address", isLabel)}
                {flag("showPhone", "Phone number")}
                {flag("showEmail", "Customer email")}
                {flag("showPaymentStatus", "Payment status")}
                {flag("showItemCount", "Number of items")}
                {opt("showImages", "Product images", o.template === "MINIMAL" || isLabel)}
                {opt("showSku", "SKUs")}
                {opt("showNote", "Order note")}
              </s-stack>
            </s-section>

            <s-section heading="Weather">
              <s-stack direction="block" gap="base">
                {flag("showWeather", "Weather forecast")}
                {flag("showNow", "Current temperature (“Now”)", !d.showWeather)}
                {flag("showRain", "Chance of rain", !d.showWeather)}
                {flag("showAsOf", "“Forecast as of” time", !d.showWeather)}
                {flag("showDates", "Dispatch and delivery dates")}
              </s-stack>
            </s-section>

            <s-section heading="Footer">
              <s-stack direction="block" gap="base">
                <s-text-area
                  label="Thank-you message"
                  details="Leave empty for no message."
                  rows={2}
                  maxLength={FOOTER_MAX}
                  value={o.footer ?? DEFAULT_THANKS}
                  onInput={(e) => setO({ ...o, footer: e.currentTarget.value })}
                />
                {flag("showStoreName", "Store name")}
                {flag("showStoreAddress", "Store address", isLabel)}
                {flag("showStoreEmail", "Store email", isLabel)}
                {flag("showStoreWebsite", "Store website", isLabel)}
                <s-text-area
                  label="Extra footer text"
                  details="Optional — returns policy, care instructions, a discount code…"
                  rows={3}
                  maxLength={TEXT_MAX.footerExtra}
                  value={d.footerExtra ?? ""}
                  onInput={(e) => setD({ footerExtra: e.currentTarget.value || null })}
                />
              </s-stack>
            </s-section>

            <s-section heading="Style">
              <s-stack direction="block" gap="base">
                <s-color-field
                  label="Accent colour"
                  details="Title, headings, lines and the dispatch/delivery days."
                  value={d.accent}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    if (/^#[0-9a-f]{6}$/i.test(v)) setD({ accent: v });
                  }}
                />
                <s-select
                  label="Font"
                  value={d.font}
                  onChange={(e) => setD({ font: e.currentTarget.value as FontKey })}
                >
                  {(Object.keys(FONTS) as FontKey[]).map((k) => (
                    <s-option key={k} value={k}>
                      {FONTS[k].label}
                    </s-option>
                  ))}
                </s-select>
                <s-select
                  label="Text size"
                  value={d.fontSize}
                  onChange={(e) =>
                    setD({ fontSize: e.currentTarget.value as SlipDesign["fontSize"] })
                  }
                >
                  {FONT_SIZES.map((f) => (
                    <s-option key={f.id} value={f.id}>
                      {f.label}
                    </s-option>
                  ))}
                </s-select>
              </s-stack>
            </s-section>
          </div>

          <div style={{ position: "sticky", top: 16 }}>
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
                    height: isLabel ? (d.labelSize === "4x4" ? 560 : 720) : 1100,
                    background: "#f3f3f3",
                  }}
                />
              </s-box>
              <s-paragraph>
                Sample order with a sample forecast. Real slips use each order&apos;s destination
                forecast at print time.
              </s-paragraph>
            </s-section>
          </div>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
