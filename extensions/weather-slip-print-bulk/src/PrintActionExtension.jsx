import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState } from "preact/hooks";

// "Weather slip" in the Print menu of Shopify's own Orders section. The
// document is rendered by the app at /print/admin (same templates and
// weather as printing from the app); the admin previews and prints it.
// Copy of weather-slip-print/ (order page) for the Orders list selection —
// keep the two in step.

const MAX = 50; // MAX_PRINT_ORDERS in app/lib/order-views.ts
const TEMPLATES = [
  ["", "defaultTemplate"],
  ["CLASSIC", "classic"],
  ["MINIMAL", "minimal"],
  ["DETAILED", "detailed"],
  ["LABEL_4X6", "label"],
];

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { i18n, data } = shopify;
  const all = (data.selected ?? []).map((s) => String(s.id).split("/").pop());
  const ids = all.slice(0, MAX);
  const [kind, setKind] = useState("slips");
  const [tpl, setTpl] = useState("");

  const params = new URLSearchParams({ kind, ids: ids.join(",") });
  if (kind === "slips" && tpl) params.set("tpl", tpl);
  const src = ids.length ? `/print/admin?${params.toString()}` : null;

  return (
    <s-admin-print-action src={src}>
      <s-stack direction="block" gap="base">
        {all.length > MAX && (
          <s-banner tone="warning" heading={i18n.translate("tooManyTitle")}>
            {i18n.translate("tooManyBody", { max: MAX })}
          </s-banner>
        )}
        <s-select
          label={i18n.translate("document")}
          value={kind}
          onChange={(e) => setKind(e.currentTarget.value)}
        >
          <s-option value="slips">{i18n.translate("slips")}</s-option>
          <s-option value="customers">{i18n.translate("customers")}</s-option>
        </s-select>
        {kind === "slips" && (
          <s-select
            label={i18n.translate("template")}
            value={tpl}
            onChange={(e) => setTpl(e.currentTarget.value)}
          >
            {TEMPLATES.map(([value, key]) => (
              <s-option key={key} value={value}>
                {i18n.translate(key)}
              </s-option>
            ))}
          </s-select>
        )}
        <s-text color="subdued">{i18n.translate("usage")}</s-text>
      </s-stack>
    </s-admin-print-action>
  );
}
