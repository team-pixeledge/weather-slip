import { useEffect, useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { localDate } from "../lib/dates";
import { refreshBrandLogo } from "../lib/brand-logo.server";
import { ensureShop, slipOptions } from "../lib/shop.server";
import {
  FONT_SIZES,
  FONTS,
  FOOTER_MAX,
  isShopifyCdnUrl,
  PAPER_SIZES,
  resolveLogo,
  isSlipTemplate,
  renderPackingSlips,
  sanitizeDesign,
  SLIP_TEMPLATES,
  TEXT_MAX,
  type FontKey,
  type LogoSource,
  type PaperSize,
  type SlipDesign,
  type SlipOptions,
} from "../lib/slip";
import { sampleSlipData } from "../lib/slip-sample";
import { DISTANCE_UNITS, type DistanceUnit } from "../lib/distance";
import { listLocations } from "../lib/distance.server";
import { PLANS, planSlipOptions, plansWith, templatePlan } from "../lib/plans";
import { SLIP_LANGUAGES, type SlipLanguage } from "../lib/slip-i18n";
import {
  recentTemplateRequests,
  shopContactEmail,
  submitTemplateRequest,
} from "../lib/template-request.server";
import {
  TEMPLATE_REQUEST_LIMITS,
  TEMPLATE_REQUEST_STATUS_LABEL,
} from "../lib/template-request";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  // Fresh on every visit, so a logo changed in Settings → Brand shows here.
  const plan = PLANS[shop.plan];
  const [brandLogoUrl, locations, requests, contactEmail] = await Promise.all([
    refreshBrandLogo(admin, shop),
    listLocations(admin),
    recentTemplateRequests(session.shop),
    plan.customTemplateRequest ? shopContactEmail(admin) : Promise.resolve(null),
  ]);
  return {
    planId: shop.plan,
    plan: {
      name: plan.name,
      templates: plan.templates,
      languages: plan.languages,
      distance: plan.distance,
      removeBranding: plan.removeBranding,
      customTemplateRequest: plan.customTemplateRequest,
    },
    upsell: {
      languages: plansWith((p) => p.languages),
      distance: plansWith((p) => p.distance),
      removeBranding: plansWith((p) => p.removeBranding),
      customTemplateRequest: plansWith((p) => p.customTemplateRequest),
    },
    requests: requests.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    contactEmail,
    locations,
    options: slipOptions(shop),
    brandLogoUrl,
    unit: shop.unit,
    today: localDate(new Date(), shop.timezone),
    shopName: session.shop.replace(/\.myshopify\.com$/, ""),
  };
};

type ActionResult =
  | { ok: true; kind: "saved" | "requested" }
  | { ok: false; kind: "requested"; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const body = (await request.json()) as Record<string, unknown>;
  const shop = await ensureShop(session.shop);

  if (body.intent === "template-request") {
    const r = await submitTemplateRequest(session.shop, shop.plan, body);
    return r.ok ? { ok: true, kind: "requested" } : { ok: false, kind: "requested", error: r.error };
  }

  // A template the plan doesn't include can't become the default. Other
  // locked settings are stored as chosen and clamped at print
  // (planSlipOptions), so a downgrade and re-upgrade loses nothing.
  const template =
    isSlipTemplate(body.template) && PLANS[shop.plan].templates.includes(body.template)
      ? body.template
      : "CLASSIC";
  // Whitelisted fields only — never pass the body to Prisma.
  const footer =
    typeof body.footer === "string" ? body.footer.slice(0, FOOTER_MAX) : null;
  await prisma.shop.update({
    where: { shop: session.shop },
    data: {
      slipTemplate: template,
      slipPaper: PAPER_SIZES.some((p) => p.id === body.paper)
        ? (body.paper as PaperSize)
        : "A4",
      slipShowImages: body.showImages === true,
      slipShowSku: body.showSku === true,
      slipShowBilling: body.showBilling === true,
      slipShowNote: body.showNote === true,
      slipFooter: footer,
      slipDesign: { ...sanitizeDesign(body.design) },
    },
  });
  return { ok: true, kind: "saved" };
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
  const setD = (patch: Partial<SlipDesign>) =>
    setO({ ...o, design: { ...d, ...patch } });

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.kind === "saved") shopify.toast.show("Packing slip saved");
  }, [fetcher.data, shopify]);

  const plan = loaded.plan;
  const requestFetcher = useFetcher<typeof action>();
  const [req, setReq] = useState({
    description: "",
    referenceUrl: "",
    contactEmail: loaded.contactEmail ?? "",
  });
  // Clear the form once per successful send (adjusting state during
  // render, not in an effect); keep the text if the send failed.
  const [handledRequest, setHandledRequest] = useState(requestFetcher.data);
  if (requestFetcher.data !== handledRequest) {
    setHandledRequest(requestFetcher.data);
    if (requestFetcher.data?.ok) setReq((r) => ({ ...r, description: "", referenceUrl: "" }));
  }
  useEffect(() => {
    if (requestFetcher.data?.ok) shopify.toast.show("Request sent — we'll reply by email");
  }, [requestFetcher.data, shopify]);

  // The preview uses what will actually be saved (e.g. a non-Shopify logo
  // link is dropped), so it never shows something the print won't.
  const previewOptions = useMemo(() => {
    const p = planSlipOptions({ ...o, design: sanitizeDesign(o.design) }, loaded.planId);
    return { ...p, design: resolveLogo(p.design, loaded.brandLogoUrl) };
  }, [o, loaded.brandLogoUrl, loaded.planId]);
  const preview = useMemo(() => {
    const { shop, order, weather, distance } = sampleSlipData(
      loaded.today,
      loaded.shopName,
    );
    return renderPackingSlips(shop, [order], weather, {
      unit: loaded.unit,
      timeZone: "UTC",
      nonce: "preview",
      chrome: false,
      autoPrint: false,
      slip: previewOptions,
      distance,
    });
  }, [previewOptions, loaded.today, loaded.shopName, loaded.unit]);

  const isLabel = o.template === "LABEL_4X6";
  // Save stays faded until something differs from what's saved.
  const dirty = JSON.stringify(o) !== JSON.stringify(loaded.options);
  const logoInvalid =
    d.logoSource === "custom" &&
    !!d.logoUrl &&
    !isShopifyCdnUrl(d.logoUrl.trim());

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
      onChange={(e) =>
        setD({ [key]: e.currentTarget.checked } as Partial<SlipDesign>)
      }
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

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          paddingBottom: 32,
        }}
      >
        <s-section heading="Template">
          {/* One row of four (plain CSS grid — s-grid's container query
              didn't apply here and wrapped to two rows). */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            {SLIP_TEMPLATES.map((t) => {
              const selected = o.template === t.id;
              const locked = !plan.templates.includes(t.id);
              const needs = PLANS[templatePlan(t.id)].name;
              return (
                <s-clickable
                  key={t.id}
                  padding="base"
                  borderRadius="base"
                  borderWidth={selected ? "large" : "base"}
                  borderColor={selected ? "strong" : "base"}
                  background={selected ? "subdued" : "base"}
                  disabled={locked}
                  accessibilityLabel={`${t.name} template${selected ? " (selected)" : ""}${locked ? ` — on the ${needs} plan` : ""}`}
                  onClick={() => {
                    if (!locked) setO({ ...o, template: t.id });
                  }}
                >
                  <div style={{ opacity: locked ? 0.55 : 1 }}>
                    <s-stack direction="block" gap="small-200">
                      <s-stack
                        direction="inline"
                        gap="small-200"
                        alignItems="center"
                      >
                        <s-text type="strong">{t.name}</s-text>
                        {selected && <s-badge tone="success">Selected</s-badge>}
                        {locked && <s-badge>{needs} plan</s-badge>}
                      </s-stack>
                      <s-text color="subdued">{t.description}</s-text>
                    </s-stack>
                  </div>
                </s-clickable>
              );
            })}
          </div>
          <s-paragraph>
            Your {plan.name} plan includes {plan.templates.length} of{" "}
            {SLIP_TEMPLATES.length} templates.
            {plan.templates.length < SLIP_TEMPLATES.length && (
              <>
                {" "}
                <s-link href="/app/plans">Upgrade for more</s-link>.
              </>
            )}
          </s-paragraph>
        </s-section>

        <s-section heading="Custom template">
          {plan.customTemplateRequest ? (
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Need a layout none of these templates fit — a branded gift
                slip, a returns form, a label for your courier? Describe it
                and we&apos;ll build it for your store and reply by email.
              </s-paragraph>
              <s-text-area
                label="What should the template look like?"
                rows={4}
                maxLength={TEMPLATE_REQUEST_LIMITS.descriptionMax}
                value={req.description}
                onInput={(e) => setReq({ ...req, description: e.currentTarget.value })}
              />
              <s-text-field
                label="Reference link (optional)"
                details="A sample PDF or image, e.g. a Shopify Files or Google Drive link."
                placeholder="https://…"
                value={req.referenceUrl}
                onInput={(e) => setReq({ ...req, referenceUrl: e.currentTarget.value })}
              />
              <s-email-field
                label="Reply to"
                value={req.contactEmail}
                onInput={(e) => setReq({ ...req, contactEmail: e.currentTarget.value })}
              />
              {requestFetcher.data && !requestFetcher.data.ok && (
                <s-banner tone="critical">{requestFetcher.data.error}</s-banner>
              )}
              <div>
                <s-button
                  onClick={() =>
                    requestFetcher.submit(
                      { intent: "template-request", ...req },
                      { method: "POST", encType: "application/json" },
                    )
                  }
                  disabled={req.description.trim().length < TEMPLATE_REQUEST_LIMITS.descriptionMin}
                  {...(requestFetcher.state !== "idle" ? { loading: true } : {})}
                >
                  Send request
                </s-button>
              </div>
              {loaded.requests.length > 0 && (
                <s-stack direction="block" gap="small-200">
                  <s-text type="strong">Your requests</s-text>
                  {loaded.requests.map((r) => (
                    <s-stack key={r.id} direction="inline" gap="small-200" alignItems="center">
                      <s-badge tone={r.status === "DONE" ? "success" : r.status === "DECLINED" ? "critical" : "info"}>
                        {TEMPLATE_REQUEST_STATUS_LABEL[r.status] ?? r.status}
                      </s-badge>
                      <s-text color="subdued">
                        {new Date(r.createdAt).toLocaleDateString()} —{" "}
                        {r.description.length > 80 ? `${r.description.slice(0, 79)}…` : r.description}
                      </s-text>
                    </s-stack>
                  ))}
                </s-stack>
              )}
            </s-stack>
          ) : (
            <s-paragraph>
              Want a template built around your brand? On the{" "}
              {loaded.upsell.customTemplateRequest} plan we design one for
              you. <s-link href="/app/plans">See plans</s-link>
            </s-paragraph>
          )}
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
            <s-section heading="Language">
              <s-select
                label="Slip language"
                value={plan.languages ? d.language : "en"}
                disabled={!plan.languages}
                details={
                  plan.languages
                    ? "Headings, dates, weather and the thank-you line print in this language. Your own texts (title, messages, footer) print as you type them."
                    : `Print slips in French, German, Spanish, Italian, Portuguese or Dutch on the ${loaded.upsell.languages} plans.`
                }
                onChange={(e) =>
                  setD({ language: e.currentTarget.value as SlipLanguage })
                }
              >
                {SLIP_LANGUAGES.map((l) => (
                  <s-option key={l.id} value={l.id}>
                    {l.label}
                  </s-option>
                ))}
              </s-select>
            </s-section>

            <s-section heading="Logo & header">
              <s-stack direction="block" gap="base">
                <s-select
                  label="Logo"
                  value={d.logoSource}
                  onChange={(e) =>
                    setD({ logoSource: e.currentTarget.value as LogoSource })
                  }
                >
                  <s-option value="store">My Shopify store logo</s-option>
                  <s-option value="custom">A different logo (link)</s-option>
                  <s-option value="none">No logo</s-option>
                </s-select>
                {d.logoSource === "store" &&
                  (loaded.brandLogoUrl ? (
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                    >
                      <img
                        src={loaded.brandLogoUrl}
                        alt="Store logo"
                        style={{
                          maxHeight: 32,
                          maxWidth: 120,
                          objectFit: "contain",
                        }}
                      />
                      <s-text color="subdued">
                        From Shopify → Settings → Brand
                      </s-text>
                    </s-stack>
                  ) : (
                    <s-text color="subdued">
                      No logo found. Weather Slip looks in Shopify{" "}
                      <s-link
                        href="shopify://admin/settings/general/branding"
                        target="_blank"
                      >
                        Settings → General → Brand
                      </s-link>
                      , then your live theme&apos;s header logo (Online Store →
                      Themes → Customize). Add one there and reopen this page —
                      or choose &quot;A different logo (link)&quot;. If you just
                      updated Weather Slip, approve its new permissions first.
                    </s-text>
                  ))}
                {d.logoSource === "custom" && (
                  <s-text color="subdued">
                    1. Open{" "}
                    <s-link
                      href="shopify://admin/content/files"
                      target="_blank"
                    >
                      Content → Files
                    </s-link>{" "}
                    and upload your logo (PNG or JPG). 2. Click the link icon on
                    the file (&quot;Copy link&quot;). 3. Paste it below.
                  </s-text>
                )}
                {d.logoSource === "custom" && (
                  <s-text-field
                    label="Logo link"
                    placeholder="https://cdn.shopify.com/…"
                    details="Must be a Shopify Files link (starts with https://cdn.shopify.com/)."
                    value={d.logoUrl ?? ""}
                    error={
                      logoInvalid
                        ? "Use a link from Shopify Files (starts with https://cdn.shopify.com/)."
                        : undefined
                    }
                    onInput={(e) =>
                      setD({ logoUrl: e.currentTarget.value || null })
                    }
                  />
                )}
                <s-select
                  label="Logo position"
                  value={d.logoPosition}
                  disabled={d.logoSource === "none"}
                  onChange={(e) =>
                    setD({
                      logoPosition: e.currentTarget
                        .value as SlipDesign["logoPosition"],
                    })
                  }
                >
                  <s-option value="left">Left, beside the title</s-option>
                  <s-option value="center">Centre, above the title</s-option>
                  <s-option value="right">
                    Right, above the order number
                  </s-option>
                </s-select>
                <s-number-field
                  label="Logo height (px)"
                  details="20–200 px. Shipping labels print it at half this size."
                  min={20}
                  max={200}
                  step={4}
                  value={String(d.logoHeight)}
                  onInput={(e) => {
                    const v = Number(e.currentTarget.value);
                    if (Number.isFinite(v)) setD({ logoHeight: v });
                  }}
                />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(
                    [
                      ["Small", 36],
                      ["Medium", 56],
                      ["Large", 80],
                      ["Extra large", 120],
                    ] as const
                  ).map(([label, px]) => (
                    <s-button
                      key={px}
                      variant={d.logoHeight === px ? "primary" : "secondary"}
                      onClick={() => setD({ logoHeight: px })}
                    >
                      {label}
                    </s-button>
                  ))}
                </div>
                <s-number-field
                  label="Maximum logo width (px)"
                  details="Keeps wide logos from crowding the header (60–500 px)."
                  min={60}
                  max={500}
                  step={10}
                  value={String(d.logoMaxWidth)}
                  onInput={(e) => {
                    const v = Number(e.currentTarget.value);
                    if (Number.isFinite(v)) setD({ logoMaxWidth: v });
                  }}
                />
                <s-text-field
                  label="Title"
                  placeholder={
                    o.template === "DETAILED"
                      ? "Packing slip & receipt"
                      : "Packing slip"
                  }
                  maxLength={TEXT_MAX.title}
                  disabled={isLabel}
                  value={d.title ?? ""}
                  onInput={(e) =>
                    setD({ title: e.currentTarget.value || null })
                  }
                />
                <s-text-area
                  label="Message at the top"
                  details="Optional, e.g. “Live plants — please open on arrival”."
                  rows={2}
                  maxLength={TEXT_MAX.headerNote}
                  value={d.headerNote ?? ""}
                  onInput={(e) =>
                    setD({ headerNote: e.currentTarget.value || null })
                  }
                />
                {flag("showOrderDate", "Order date")}
                {flag("showShippingMethod", "Shipping method")}
                <s-select
                  label="Scannable order number"
                  details="For warehouses: scan the slip to find the order."
                  value={d.orderCode}
                  onChange={(e) =>
                    setD({
                      orderCode: e.currentTarget.value as SlipDesign["orderCode"],
                    })
                  }
                >
                  <s-option value="none">None</s-option>
                  <s-option value="qr">QR code</s-option>
                  <s-option value="barcode">Barcode (Code 128)</s-option>
                </s-select>
              </s-stack>
            </s-section>

            <s-section heading="Customer">
              <s-stack direction="block" gap="base">
                {isLabel ? (
                  <s-select
                    label="Label size"
                    value={d.labelSize}
                    onChange={(e) =>
                      setD({
                        labelSize:
                          e.currentTarget.value === "4x4" ? "4x4" : "4x6",
                      })
                    }
                  >
                    <s-option value="4x6">4 × 6 in (100 × 150 mm)</s-option>
                    <s-option value="4x4">4 × 4 in (100 × 100 mm)</s-option>
                  </s-select>
                ) : (
                  <s-select
                    label="Paper size"
                    value={o.paper}
                    onChange={(e) =>
                      setO({ ...o, paper: e.currentTarget.value as PaperSize })
                    }
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
                {opt("showNote", "Order note (cart note)")}
                {flag(
                  "showCartAttributes",
                  "Cart attributes (gift message, delivery instructions)",
                )}
              </s-stack>
            </s-section>

            <s-section heading="Line items">
              <s-stack direction="block" gap="base">
                {opt(
                  "showImages",
                  "Product images",
                  o.template === "MINIMAL" || isLabel,
                )}
                <s-select
                  label="Image size"
                  value={d.itemImageSize}
                  disabled={
                    !o.showImages || o.template === "MINIMAL" || isLabel
                  }
                  onChange={(e) =>
                    setD({
                      itemImageSize: e.currentTarget
                        .value as SlipDesign["itemImageSize"],
                    })
                  }
                >
                  <s-option value="S">Small</s-option>
                  <s-option value="M">Medium</s-option>
                  <s-option value="L">Large</s-option>
                </s-select>
                <s-select
                  label="Long product titles"
                  value={String(d.titleMax)}
                  onChange={(e) =>
                    setD({
                      titleMax: Number(
                        e.currentTarget.value,
                      ) as SlipDesign["titleMax"],
                    })
                  }
                >
                  <s-option value="0">Show in full</s-option>
                  <s-option value="80">Shorten to 80 characters</s-option>
                  <s-option value="50">Shorten to 50 characters</s-option>
                  <s-option value="30">Shorten to 30 characters</s-option>
                </s-select>
                {flag("showVariant", "Variant (size, colour…) on its own line")}
                {opt("showSku", "SKU")}
                {flag("showVendor", "Vendor")}
                {flag("showBarcode", "Barcode")}
                {flag(
                  "showProperties",
                  "Item properties (engraving, personalisation…)",
                )}
                {flag(
                  "showPrices",
                  "Prices and line totals",
                  o.template === "DETAILED",
                )}
                {flag(
                  "showCompareAt",
                  "Compare-at price (struck through)",
                  !(d.showPrices || o.template === "DETAILED"),
                )}
                {flag(
                  "showTotals",
                  "Order totals (subtotal, shipping, tax)",
                  o.template === "DETAILED",
                )}
                <s-select
                  label="Quantity"
                  value={d.qtyFormat}
                  onChange={(e) =>
                    setD({
                      qtyFormat:
                        e.currentTarget.value === "plain" ? "plain" : "of",
                    })
                  }
                >
                  <s-option value="of">
                    “1 of 2” (left to ship of ordered)
                  </s-option>
                  <s-option value="plain">Just the number</s-option>
                </s-select>
                <s-select
                  label="Which items"
                  value={d.itemsScope}
                  onChange={(e) =>
                    setD({
                      itemsScope:
                        e.currentTarget.value === "all" ? "all" : "unfulfilled",
                    })
                  }
                >
                  <s-option value="unfulfilled">
                    Only items still to ship
                  </s-option>
                  <s-option value="all">All items in the order</s-option>
                </s-select>
                <s-select
                  label="Sort items by"
                  value={d.itemSort}
                  onChange={(e) =>
                    setD({
                      itemSort: e.currentTarget.value as SlipDesign["itemSort"],
                    })
                  }
                >
                  <s-option value="order">Order of purchase</s-option>
                  <s-option value="name">Product name</s-option>
                  <s-option value="sku">SKU</s-option>
                </s-select>
              </s-stack>
            </s-section>

            <s-section heading="Weather">
              <s-stack direction="block" gap="base">
                {flag("showWeather", "Weather forecast")}
                {flag("showNow", "Current temperature (“Now”)", !d.showWeather)}
                {flag("showRain", "Chance of rain", !d.showWeather)}
                {flag("showAsOf", "“Forecast as of” time", !d.showWeather)}
                {flag("showDates", "Dispatch and delivery dates")}
                <s-select
                  label="Forecast days"
                  value={d.forecastRange}
                  disabled={!d.showWeather}
                  onChange={(e) =>
                    setD({
                      forecastRange:
                        e.currentTarget.value === "trip" ? "trip" : "all",
                    })
                  }
                >
                  <s-option value="all">Today to the end of the forecast</s-option>
                  <s-option value="trip">Dispatch to delivery only</s-option>
                </s-select>
                {flag(
                  "showTip",
                  "Weather tip when delivery day brings rain, frost or heat",
                  !d.showWeather,
                )}
                <s-paragraph>
                  Dispatch and delivery days with a 60%+ chance of rain,
                  freezing temperatures or 35 °C+ get a warning badge.
                </s-paragraph>
              </s-stack>
            </s-section>

            <s-section heading="Distance">
              <s-stack direction="block" gap="base">
                {flag(
                  "showDistance",
                  "Distance from the fulfillment location to the customer",
                  !plan.distance,
                )}
                {!plan.distance && (
                  <s-text color="subdued">
                    On the {loaded.upsell.distance} plans.
                  </s-text>
                )}
                <s-select
                  label="Unit"
                  value={d.distanceUnit}
                  disabled={!d.showDistance || !plan.distance}
                  onChange={(e) =>
                    setD({ distanceUnit: e.currentTarget.value as DistanceUnit })
                  }
                >
                  {DISTANCE_UNITS.map((u) => (
                    <s-option key={u.id} value={u.id}>
                      {u.label}
                    </s-option>
                  ))}
                </s-select>
                <s-select
                  label="Measure from"
                  value={d.distanceFrom}
                  disabled={!d.showDistance || !plan.distance}
                  details={
                    loaded.locations
                      ? "Each order's own location follows Shopify: change an order's fulfillment location and the next print updates."
                      : "Approve location access when Shopify asks (reopen the app) to pick a specific location."
                  }
                  onChange={(e) => setD({ distanceFrom: e.currentTarget.value })}
                >
                  <s-option value="order">
                    The order&apos;s fulfillment location (recommended)
                  </s-option>
                  {(loaded.locations ?? []).map((l) => (
                    <s-option key={l.id} value={l.id}>
                      {l.place ? `${l.name} — ${l.place}` : l.name}
                    </s-option>
                  ))}
                </s-select>
                <s-paragraph>
                  Straight-line distance (as the crow flies), not the driving
                  route. Without a location it&apos;s measured from your store
                  address.
                </s-paragraph>
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
                  onInput={(e) =>
                    setD({ footerExtra: e.currentTarget.value || null })
                  }
                />
                {flag(
                  "showBranding",
                  "“Weather Slip” mark at the foot of each printed page",
                  !plan.removeBranding,
                )}
                {!plan.removeBranding && (
                  <s-text color="subdued">
                    Removing the mark is part of the{" "}
                    {loaded.upsell.removeBranding} plan.
                  </s-text>
                )}
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
                  onChange={(e) =>
                    setD({ font: e.currentTarget.value as FontKey })
                  }
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
                    setD({
                      fontSize: e.currentTarget.value as SlipDesign["fontSize"],
                    })
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
              <s-box
                borderWidth="base"
                borderRadius="base"
                overflow="hidden"
                background="subdued"
              >
                <iframe
                  title="Packing slip preview"
                  srcDoc={preview}
                  sandbox=""
                  style={{
                    display: "block",
                    border: 0,
                    width: "100%",
                    height: isLabel
                      ? d.labelSize === "4x4"
                        ? 560
                        : 720
                      : 1100,
                    background: "#f3f3f3",
                  }}
                />
              </s-box>
              <s-paragraph>
                Sample order with a sample forecast. Real slips use each
                order&apos;s destination forecast at print time.
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
