@AGENTS.md

# Weather Slip — project notes

Read before exploring. Update when something architecturally significant
changes; don't let it drift.

## What this is

Shopify **public** embedded app: saves destination weather (current +
dispatch-day + delivery-day forecast) on each order as order metafields, so
packing slips, invoices and emails can print it with one Liquid line.
Free (30 orders) / Starter $4.99 (500) / Pro $9.99 (2,000) / Business $19.99 (5,000), yearly $49/$99/$199 — `app/lib/plans.ts` (2026-10-13; feature ladder 2026-10-14, see "Plan ladder"). Scaffolded 2026-10-12
from `Shopify/shopify-app-template-react-router` (React Router 7, Prisma,
Polaris web components). Sibling app for conventions/lessons:
`../store-performance-monitor` (its CLAUDE.md documents several Shopify CLI
and deploy traps this app's config already avoids).

## Core design — the rules that matter

- **We never render anyone's invoice.** Output is two order metafields in
  namespace `weather_slip` (`app/lib/constants.ts`): `summary` (one line of
  plain text — no emoji/HTML, it must survive PDF renderers) and `snapshot`
  (JSON, both °C and °F). Shopify's packing slip, Order Printer and Order
  Printer Pro all read `order.metafields.ns.key`. Snippets: `/app/snippets`.
- **Weather only on print (user decision 2026-10-12).** New orders get
  nothing: `orders/create` isn't subscribed. The first print of a slip from
  the Orders page (`/app`) fetches weather and enqueues a CREATE job that writes the
  metafield, so Shopify's own slip shows it from then on.
- **Reprints never change by accident.** The first snapshot is written once
  per order; a duplicate CREATE is a no-op. Recompute only on: a real
  destination change (`locationKey` fingerprint differs) before shipping, a
  merchant Refresh, a pending-date fill, or a **missed dispatch day** (user
  decision 2026-10-15: an unshipped order whose dispatch date is before
  today in the shop's timezone gets dispatch = today, next weekday if
  skipping weekends — `shippingDates({ today })` — and the print path
  refetches the slip forecast and enqueues REFRESH). Fulfillment **freezes** the
  snapshot (`frozenAt`) — it is not recomputed with the real ship date, so a
  slip printed while picking matches any later reprint.
- **Pending fill only fills.** A date beyond the provider's horizon prints
  "forecast pending"; `fillPendingDays` later fills just those days and
  leaves everything already printed untouched.
- **Every change is a new version** (`OrderWeatherSnapshot.version`); the
  highest is live. Old versions are kept.
- **Address data is minimised** (Level 2 protected customer data): the
  weather job's order query asks only for city/zip/country/coordinates
  (the print views read more, render it, and store none of it); we store city,
  country, a 0.1° (~11 km) grid point and a hash. Never the street, name,
  email or phone. Jobs hold only the order ID, never the payload.
- **Weather cache is shared across shops**, keyed by provider + 0.1° grid
  cell, 3h TTL (`cache.server.ts`); geocodes 30 days.
- **Plans count prints, not API calls** (user decision 2026-10-14, replacing
  "each order once, reprints free" from 2026-10-12): every order on every
  print with weather uses one unit, reprints included. `chargePrint`
  (`shop.server.ts`) upserts `CountedOrder` and only charges if
  `lastPrintedAt` is null or older than `PRINT_RECHARGE_MS` (10 min — so the
  admin print preview, a reload or a double-click don't each charge), then
  takes `consumeUsage` in the same transaction; at the limit it rolls back.
  At the limit even a saved forecast prints as "plan limit reached".
  Shopify Flow only `markCounted`s (no unit); jobs never charge and only run
  for orders in `CountedOrder`. Upsert semantics checked on Postgres
  (PGlite) 2026-10-14: charge / free within 10 min / charge after / rollback
  keeps the old timestamp. Usage still resets every 30 days.

## Orders page + printed packing slips (added 2026-10-12)

The Orders page is the app home (`/app`, `rel="home"` in the nav, so the admin sidebar shows no separate Orders item; `/` and `/app/orders` redirect to it — there's no public landing page). It lists the shop's orders live from Shopify, laid out like
Shopify's own Orders page on purpose (user request: familiar + compact):
same tabs (All, Unfulfilled, Unpaid, Open, Archived), columns (Order, Date,
Customer, Channel, Total, Payment/Fulfillment badges, Items, Delivery
method, Tags) plus Weather; bulk print actions appear as a row above the filters while
orders are selected (the filters/search stay visible — 2026-10-15); 25/50/100/250 rows a page (`?per=`, default 50); it
re-runs its loader every 30s while visible and on the first page, so new
orders appear without a reload (views;
date range Any time/30/60/180/365 days via `created_at:>=`; orders older
than 60 days need `read_all_orders`, which Shopify must approve for the app
— keep Vercel's `SCOPES` env in step with the toml, or auth loops; search is Shopify's own
order search, bracketed so it can't widen the view; cursor pagination;
selection kept across pages). "Print packing slips" / "Print customer
list" (max 50 orders, `order-views.ts`) open `/print/slips` or
`/print/customers` in a new tab: plain HTML the browser prints or saves as
PDF (no headless Chrome on Vercel).
- **Auth for the print tab** is a 2h HMAC token (`print-token.server.ts`,
  keyed on `SHOPIFY_API_SECRET`) carrying only the shop, signed by the
  Orders loader. Order IDs go in the URL and are fetched with that shop's
  offline token, so a token can't reach another shop. Responses are
  `no-store`, `no-referrer`, nonce-CSP, images from cdn.shopify.com only.
- **Slip weather: one lookup per order, ever** (user requirement
  2026-10-12). The first print fetches the forecast (today at the
  destination → provider horizon, dispatch/delivery outlined) and saves it
  on the order as metafield `weather_slip.forecast` (JSON SlipWeather,
  `parseSavedSlipWeather` reads it back). Every reprint — in-app or from
  Shopify's Print menu — uses that: no weather/geocode API call, identical
  slip — except an unshipped order whose saved dispatch day has passed,
  which is fetched again once with rolled-forward dates (see above). Only "ok" forecasts are saved, so a limit-reached or
  no-address print can still get weather later. The slip reuses the
  snapshot's dispatch/delivery dates when one exists.
- **Plan limits on print:** each order with a usable destination (or saved
  weather) goes through `chargePrint` (no destination → no weather, no
  charge); refused → the slip prints "plan limit reached" instead of
  weather. An order without saved weather then gets a CREATE/REFRESH job
  (jobs never charge).
- **Protected customer data:** slips print the customer name, street
  address and phone. They're read from Shopify per print and never stored —
  but the Partner Dashboard request must now cover **name, address and
  phone** (not email). Until it's approved, Shopify returns those fields as
  null with an error; `orders.server.ts` keeps the partial data so slips
  still print with blanks instead of failing.
- Queries were validated against the 2026-10 Admin schema
  (introspection of `shopify.dev/admin-graphql-direct-proxy/2026-10`), but
  not yet run against a real store.

## Slip templates (added 2026-10-12)

Printing in the app is the main path; "Shopify templates" (`/app/snippets`,
the Liquid snippet for Shopify's own slip/Order Printer/emails) is optional.
`/app/slip` picks the shop's default template and options with a live
preview (sample order from `slip-sample.ts`, rendered client-side in a
sandboxed iframe by the same `renderPackingSlips` the print tab uses).
  The sample's dispatch/delivery come from `shippingDates` with the shop's
  `planShippingDays` (it used to be today+1/+3, landing on weekends with
  "Count weekdays only" on).
- Weather icons (`weather-icons.ts`): inline SVG chosen from the
  condition *label* (clear / partly / cloudy / rain / storm / snow / fog),
  so it's provider-neutral; used in forecast cards, tables and "Now".
- Templates (`slip.ts`): CLASSIC (cards), MINIMAL (ink saver, forecast
  table, no images), DETAILED (prices, line totals, order totals — the only
  template with money), LABEL_4X6 (`@page 4in 6in`, big ship-to, no bill-to
  or store footer).
- Options on `Shop.slip*`: paper A4/A5/Letter/Legal (ignored for labels),
  images, SKUs, bill-to, note, footer (null = default thank-you, "" = none,
  max 300).
- Full customisation in `Shop.slipDesign` (JSON, `SlipDesign` in `slip.ts`,
  always read/written through `sanitizeDesign`): logo (a cdn.shopify.com
  link from Shopify Files — the Admin API exposes no brand logo, and the
  print CSP allows only that image host), position left/centre/right and
  size, title, top message, order date / shipping method / phone / email /
  payment status / item count, each weather part, each footer part + extra
  text, accent colour (CSS var), system font stacks only (no external
  fonts under the CSP), five text sizes, label 4×6 or 4×4. Customer email
  prints only once Email is granted in protected customer data.
- `/app/slip`: template row, settings column + sticky live preview.
- **Page breaks**: `.page + .page { break-before: page }`. Never
  `break-after` on `.page` — the mark and script follow the last page in
  `<body>`, so a `:last-child` exception never matched and every print
  had a blank last page (fixed 2026-10-15, tested).
- **Fit to one page** (2026-10-15): a full slip (logo, distance, cards,
  items, footer) ran a few lines past A4/Letter/labels, printing a
  near-empty second page. `FIT_SCRIPT` measures each `.page` at the sheet
  width with its print padding (`.fit-measure`, sheet px on `<body
  data-sheet-w/h>` from `PAPER_SIZES.px`/label size) and zooms it to fit
  if it overflows by ≤40%; longer slips still flow. Runs on load, on
  beforeprint and before auto-print, also in Shopify's print preview.
  Verified with headless-Chrome PDFs of every template (all 1 page).
- **No `style=""` attributes in slip HTML.** The print page's CSP only
  allows its nonce'd `<style>`, so inline styles are silently dropped in
  real prints — while the in-app preview (srcdoc, no CSP) still shows
  them. Sizes go through CSS variables in `designVars` (--logo-h,
  --logo-w, --img…). A test fails if any template emits `style="`.
- **Line items** (design fields): image size, title shortening (30/50/80),
  variant line, SKU, vendor, barcode, item properties (keys starting "_"
  hidden, as at checkout), prices + struck "was" price (compare-at or
  pre-discount, whichever is higher), totals, quantity "1 of 2" or plain,
  unfulfilled-only or all items, sort by order/name/SKU, cart attributes.
  Compare-at and barcode come from `lineItem.variant`, which needs
  `read_products` (granted with the 2026-10-12 release); the print query
  keeps partial data if it's missing.
- **Store logo** (`brand-logo.server.ts`): `logoSource` store (default) /
  custom link / none. The Admin API has no brand logo, so the app creates
  its own Storefront token (`storefrontAccessTokenCreate`, needs the
  `unauthenticated_read_content` scope; token encrypted in
  `Shop.storefrontTokenEnc`) and reads `shop.brand.logo` — works on
  password-protected stores, where tokenless Storefront calls fail
  ("Online Store channel is locked"). Cached in `Shop.brandLogoUrl`;
  refreshed on every Packing slip visit and at most daily when printing;
  `resolveLogo` picks what prints. Failures keep the last known logo.
  Fallback when Brand has no logo (most stores set it in the theme): the
  MAIN theme's `config/settings_data.json` (read_themes; strip Shopify's
  leading /* */ comment; `current` may be a preset name) → first
  `shopify://shop_images/<file>` under a logo key (`findThemeLogoRef`) →
  Files API `filename:` lookup (read_files) → CDN URL.
- The Orders page can override the template for one print (`?tpl=`).
- **Language** (`SlipDesign.language`, `slip-i18n.ts`, 7 languages): every
  printed string goes through `slipStrings`; dates/money/distance use the
  locale (English keeps en-GB dates and en-US money as before). Provider
  condition labels stay English in storage and are mapped at render by
  keyword (`conditionOf`); unknown labels print as-is. Admin UI, customer
  list and the summary metafield stay English.
- **Bad weather**: dispatch/delivery days with ≥60% rain, min ≤0 °C or
  max ≥35 °C (`BAD_WEATHER`) get coloured badges (`print-color-adjust:
  exact`); a delivery-day one adds a one-line tip (`showTip`). Rain reads
  "n% chance of rain" with a drop icon. `forecastRange: "trip"` shows
  dispatch→delivery only. Minimal is ink-saving: hairlines, no fills.
- No product image anywhere → the image column is dropped (no "No image").
- **Order code**: `orderCode` none/qr/qr_number/barcode — `order-code.ts`,
  QR via `qrcode-generator`, Code 128-B hand-written (table + checksum
  tested). `qr` encodes the order's `statusPageUrl` (customer's order
  status / thank-you page, works without login — user decision 2026-10-15)
  at ECC level L, printed 96px (72px on labels) with a translated "Scan to
  see your order" caption; falls back to the order number if the URL is
  missing. `qr_number`/`barcode` = order number for warehouse scanners.
  Decoding verified with OpenCV.
- Prices come from the order (currentSubtotal/Tax/Total, shipping); they
  aren't protected customer data.

## Distance on the slip (added 2026-10-13)

`app/lib/distance.ts` (pure: haversine, km/mi/nmi formatting) +
`distance.server.ts`. Settings live in `SlipDesign` (`showDistance`, off by
default; `distanceUnit`; `distanceFrom` = `"order"` or a numeric Location
id). Computed at every print, never stored, so moving an order to another
location or editing its address changes the next print.
- Origin = the order's fulfillment orders' assigned locations: live ones
  (not CLOSED/CANCELLED; a moved FO is CANCELLED), else the CLOSED ones it
  shipped from. A split order shows one distance per location. No visible
  FO → store address (`shop.shopAddress`).
- Coordinates from Shopify (location address, shipping address); missing →
  `cachedGeocode` on city/zip (same cache as weather).
- Straight line, labelled as such — not a route distance.
- Needs `read_locations`, `read_merchant_managed_fulfillment_orders`,
  `read_third_party_fulfillment_orders`; the origins query is separate
  from the print query so a missing scope only falls back to the store
  address, never breaks printing.

## Printing from Shopify's own Orders section (added 2026-10-12)

Two admin print action extensions (one target each, as Shopify requires):
`extensions/weather-slip-print` (order page → Print) and
`extensions/weather-slip-print-bulk` (Orders list selection → Print). Same
JSX in both — keep them in step. They pick a document (packing slip /
customer list) and template, and point `s-admin-print-action src` at the
app's `/print/admin?kind&ids&tpl` (relative = app URL). That route uses
`authenticate.admin` + `cors` (the admin sends a session token), renders
with the same `renderPrint` as `/print/slips` but with no toolbar or
auto-print, and allows the admin to frame it (`frame-ancestors`). Opening
the preview uses a print, same as printing from the app (a repeat within
10 minutes is free, so re-rendering the preview doesn't charge again).

## Plans & billing (added 2026-10-12, reworked same day)

`/app/plans` is also the app's overview (the Overview page was merged in;
`/app` is the Orders list). Layout follows
store-performance-monitor's `billing/select-plan`: current-plan card with
usage, equal-height plan cards (active = green border, "Activated"), Free
switch confirmed inline, "Compare all features" table.
- Billing API called directly (`billing.server.ts`), not the library's
  `billing.request` (it always answers with a redirect, hiding Shopify's
  userErrors). `appSubscriptionCreate` with `replacementBehavior:
  APPLY_IMMEDIATELY` for upgrades and downgrades; the action returns the
  confirmationUrl and the page opens it with `window.open(url, "_top")`.
  Return URL = admin.shopify.com/store/<handle>/apps/<api key>/app/plans;
  Shopify appends `charge_id`, whose status the loader reads for the
  activated/declined banner. Current plan stays until the new charge is
  approved. Free = `appSubscriptionCancel(prorate: true)` first, then sync.
- `syncPlan` reads `currentAppInstallation.activeSubscriptions` and writes
  `Shop.plan`; runs on every Plans load, before every plan change, and on
  the `app_subscriptions/update` webhook.
- Test charges while `SHOPIFY_BILLING_TEST` isn't "false", and always on
  development stores (`shop.plan.partnerDevelopment`). A test subscription
  only unlocks a plan in those same conditions.

## Get started checklist (Plans page)

Ticks come from the shop's own data: slip saved (`slipDesign`), first
print (`CountedOrder`). (The shipping-days step was
removed when shipping days became fixed by plan.) Steps done outside the
app live in `Shop.checklistDone` (`CHECKLIST_STEPS`): printing from
Shopify's print menu and a Flow run tick themselves (`setChecklistStep`);
any of them can be marked/unmarked by hand. The badge counts every step
the plan includes ("2 of 4"), not only the auto-tracked ones — showing
"2 of 2" over five listed steps confused merchants (2026-10-15).

## Printed orders (added 2026-10-14)

`PrintedOrder (shop, orderId, firstPrintedAt, lastPrintedAt, printCount)`,
written by `recordPrints` after every slip render (app tab and admin print
action; not the customer list) — separate from `CountedOrder` (weather/
usage), so an order printed without weather still shows as printed. Repeat
within 10 min doesn't bump printCount. Orders page: printed rows are dimmed
(`Dim`), green "n Printed" badge whose `s-tooltip` lists every print
(`printedAt[]`, newest last in the DB, capped at PRINT_HISTORY_MAX = 50;
"+ n earlier" if the count exceeds the history), button "Reprint". No Tags
column (user request 2026-10-14). Never interpolate `${…}` inside a SQL
comment in a Prisma tagged template — it becomes a query parameter. Migration
`printed_orders` backfills from CountedOrder rows created before per-print
charging (10:50:24 UTC) or with lastPrintedAt. customers/redact deletes them.

## Embedded reloads (fixed 2026-10-14)

A page showing only "200" = a hard reload inside the iframe without
Shopify's shop/host params (React Router dropped them on client
navigation; lazy route discovery hard-reloaded after a deploy). Fixed by
`routeDiscovery: { mode: "initial" }` (react-router.config.ts) plus the
`RELOAD_GUARD` script in root.tsx (restores shop/host from sessionStorage
once, then Shopify's session-token bounce runs) and a friendly root
ErrorBoundary. Keep both when touching root/config.

## Plan ladder (user decision 2026-10-14: higher plans must clearly get more)

Every gate reads `PLANS` in `plans.ts`; the Plans cards render from
`planFeatures`. Enforced server-side, not just hidden in the UI:
- **Templates** 1/2/3/4: Free Classic, Starter +Minimal, Pro +Detailed,
  Business +Shipping label. **Order views**: Free/Starter only Unfulfilled
  (incl. partially fulfilled) — `allowedView` in the Orders loader; Pro+ all.
- Starter+: dispatch day — in the saved summary AND on the printed slip
  (`SlipDesign.showDispatch`, clamped by planSlipOptions; Free slips show
  delivery only — missed until 2026-10-14), print action in Shopify's
  Orders (`/print/admin` 403s on Free), customer list, Order Printer setup
  guide (only the guide: the snippet is the same one Free uses, and Liquid
  can read the metafield anywhere — not enforceable, so the card says
  "guide").
- **Forecast days by plan** (user decision 2026-10-14): Free/Starter today
  + 2, Pro + 3, Business + 4 (provider max). `PlanLimits.forecastDaysAhead`
  → `SlipDesign.maxDaysAhead` (plan-set only, via planSlipOptions; slips
  trim the saved forecast at render, so upgrades show more on old orders;
  notes/tips only use shown days) and caps the saved summary's horizon in
  order-weather.server (pending fills wait until the date is in range).
- **Shipping days fixed by plan** (user decision 2026-10-14, after being
  told it makes delivery dates approximate): handling 1 + transit 1/1/2/3
  (Free/Starter/Pro/Business) via `planShippingDays` in
  `orderShippingDates`; Settings shows them read-only, "Count weekdays
  only" stays the shop's. `Shop.handlingDays/transitDays` and
  `settingsSavedAt` are now unused (kept in the schema); the "Set your
  shipping days" checklist step was removed. handling + transit ≤
  forecastDaysAhead (tested).
- Free/Starter "unfulfilled only" is enforced at print too
  (`planAllowsOrder` in the print route: fulfilled/restocked/cancelled/
  closed orders are skipped unless printed before; skipped ones are named in
  the toolbar, or a 403 page if all are), because Starter can print from
  Shopify's own Orders page.
- Pro+: slip language, distance, Shopify Flow action. Business: hiding the
  Weather Slip mark. (Custom template requests were removed entirely
  2026-10-15, user decision — form, plan flag, checklist step, FAQ, and the
  `TemplateRequest` table, dropped by `20261015120000_drop_template_requests`.
  Don't re-add.)
- **Watermark** (user decision 2026-10-14, merchant's own, tiered): Free
  none, Starter `WATERMARK_PRESETS` words only, Pro any text, Business logo
  (the slip's resolved logo) or text — `planWatermark`. Rendered as `.wm`
  at z-index -1 inside each `.page` (isolated stacking context), sizes and
  opacity via CSS vars, accent colour.
- **Settings are stored as chosen and clamped at every render** by
  `planSlipOptions` (print route, Orders default, slip preview), so a
  downgrade + re-upgrade loses nothing. Only the saved default template is
  coerced to Classic on save if locked. A locked template *picked for one
  print* (`?tpl=`, in-app or from Shopify's print menu) is refused with a
  403 page naming the plans that have it — not silently printed as
  Classic (2026-10-15). The admin print extensions read
  `/api/print-options` (authenticate.admin + cors) and disable locked
  templates in their menu.
- **Yearly billing**: subscription name "Pro (yearly)", `interval: ANNUAL`,
  price `annualPriceUsd`. `planFromBillingName`/`intervalFromBillingName`
  map names back — never rename existing subscription names. Usage still
  resets every 30 days.
- **POS and local pickup orders are never listed** (no address to
  forecast): `NO_SHIPPING_FILTER` (`delivery_method` pick-up/retail) in
  every list query, plus a post-filter for POS rows with no address. The
  filter syntax wasn't run against a real store yet — check on a dev store.
- **Every print counts, reprints/re-packs included** (user decision
  2026-10-14) — see "Plans count prints" above.

## Shopify Flow action (added 2026-10-14, Pro and Business)

`extensions/weather-slip-flow-save` (type `flow_action`, order_reference
field) → `app/routes/flow.save-weather.tsx` via `authenticate.flow` (HMAC).
Same path as a first print (`weatherForSlips`: count once, save the slip
forecast, enqueue CREATE). Flow wants a status in 10 s: we wait up to 7 s,
then finish in the background and return 200. 4xx bodies
(`{message}`) show in the merchant's Flow run log: 402 plan, 422 limit
reached (not 429 — that retries for 36 h), 404 order. Weather failure →
503 so Flow retries. Needs `shopify app deploy` to exist in Flow.

**Flow can't print** (it runs on Shopify's servers; browsers only print
from an open page). Instead the Orders page shows a "n orders ready to
print" banner (user decision 2026-10-15): `readyToPrintIds` = CountedOrder
rows from the last 14 days with no PrintedOrder, re-checked with Shopify
as unfulfilled (`listOrders({ ids })` → `id:` OR-filter; empty set =
`id:0`). One button prints the first 50; `?ready=1` lists only them.
An order printed only via Shopify's own Liquid slip never gets a
PrintedOrder, so it stays "ready" until the 14 days pass or it ships.

Flow template `extensions/weather-slip-flow-paid` (released in
weather-slip-11, 2026-10-14): "Order paid → Save weather on order".
`template.flow` is the Flow editor's export, kept verbatim (its hash
prefix isn't a plain SHA-256 — don't hand-edit; rebuild in Flow and
re-export). Locales en + fr. Shopify reviews templates before they show in
the library; the deep link for an in-app "Set up in Flow" button comes from
the library's Share button after publishing.

## Operator alerts (added 2026-10-13)

`alerts.server.ts` emails the operator (SMTP via nodemailer; env
`ALERT_EMAIL_TO/FROM`, `SMTP_HOST/PORT/USER/PASS`; unset = log only).
`notifyAdmin(key, …)` sends at most once per key per hour (`AdminAlert`
row counts suppressed repeats). Triggers: OpenWeather 401/429/5xx/timeout
(hook passed into `OpenWeatherProvider`), monthly OpenWeather usage at
50/80/95/100% of 1M (`ApiUsage`, threshold claimed atomically — a jump
emails only the highest crossed), a job failing for good, a print
crashing (`safeRenderPrint` → friendly 500), a plan change failing, slip
weather failing, any loader/action error (`handleError` in entry.server),
and an order count crossing 80%/100% of the shop's plan (emailed to the
**shop owner**, not the operator — `usage-alerts.server.ts`; once per level
per usage period, reset with the period and on a plan change; Orders and
Plans pages show `UsageBanner` from 80%). Monitoring never throws.

## Weather providers

`WeatherProvider` interface (`app/lib/weather/types.ts`); labels come from
the provider. `WEATHER_PROVIDER` picks one:
- **`openweather` (default)** — free plan: 1M calls/month, 60/min, Current
  + 5 day/3 hour Forecast + Geocoding. **No 16-day daily on free** (paid
  Startup+), so `horizonDays = 4`; 3-hour slots are aggregated per
  destination-local day, dropping partial days (`aggregateDaily`).
  `OPENWEATHER_API_KEYS` is a comma list from one account: the next key is
  used **only on 401**. A 429 is not failed over — keys share an account
  quota, and spreading load over several accounts to dodge limits risks
  suspension. The user plans to move to a paid plan once installs grow;
  when that happens, switch the forecast call to the 16-day daily endpoint
  and raise `horizonDays`.
- `open-meteo` — kept as an alternative; its free endpoint is
  non-commercial, so it needs `OPEN_METEO_API_KEY` in production.
- Merchants can't use their own weather API key (removed 2026-10-14, user
  decision: the app is the product — don't re-add a bring-your-own-key
  option). `Shop.weatherApiKeyEnc` is left in the schema, unused.
- **Attribution is mandatory** (OpenWeather: ODbL, visible credit where
  the data is shown — a FAQ alone isn't enough). Every slip prints
  "Weather data © <provider>" (`creditHtml`, translated, never hidden by
  `showBranding`); `SlipWeather.source` records the provider (old saved
  forecasts read as openweather); the Shopify snippet carries the line too.
  Listing copy: `docs/app-store-listing.md` — no "live" weather claims.
- OpenWeather gives a UTC offset, not an IANA zone: `utcOffsetSec` is kept
  exactly (India +5:30) — `destinationToday()` uses it. Don't round it.

## Hosting: Vercel now, AWS later (user decision, 2026-10-12)

- No long-running worker on Vercel. Queue = Postgres table `WeatherJob`,
  claimed with `FOR UPDATE SKIP LOCKED` (`jobs.server.ts`), driven by the
  platform-neutral `drainQueue`/`runMaintenance` (`queue-runner.server.ts`):
  - webhooks enqueue, return 200, then `runInBackground(drainQueue())`
    (`background.server.ts` — Vercel `waitUntil`; the one file to change
    off Vercel);
  - `/api/cron/drain`, guarded by `Authorization: Bearer $CRON_SECRET` —
    retries, pending fills, pruning. Called daily by Vercel Cron
    (`vercel.json`); prints and order webhooks drain inline, so the cron
    only picks up leftovers. The 10-minute GitHub Actions runner was removed
    2026-10-14 (it never ran — `APP_URL` secret was missing — and its
    heartbeat check only produced false alarms). `Heartbeat` table unused.
- **Vercel team "Test" (`test11-fc37`, account teampixeledge-1075) is on
  Hobby** (user decision 2026-10-12, budget). Hobby crons run at most daily
  (user decision: daily is enough for now — don't re-add an external
  scheduler). Hobby's terms are non-commercial: upgrade to Pro before
  charging merchants, then set `vercel.json` to `*/10`.
- Vercel CLI for this account uses its own config dir:
  `vercel --global-config ~/.vercel-teampixeledge …` (the default CLI login
  on this machine is a different account).
- `react-router.config.ts` applies `vercelPreset()` only when `VERCEL` is
  set, so the same repo still builds as a plain Node server (Dockerfile).
  AWS move: run the Docker image (App Runner/ECS) + `npm run worker`
  (`scripts/worker.ts`) or a scheduled Lambda calling `drainQueue`, and
  swap `runInBackground` — no queue/data changes needed.
- **Live**: https://weather-slip.vercel.app (Vercel project `weather-slip`,
  team `test11-fc37`, Git-connected to team-pixeledge/weather-slip `main`).
  Verified 2026-10-12: pages 200, cron 401 without secret / drains with it,
  webhooks 401 on a forged HMAC (what app review checks).
- Vercel gotchas hit on first deploy: a CLI-created project has no
  framework → static-only output, every route 404 — `vercel.json` pins
  `"framework": "react-router"`. A raw `buildCommand` runs without
  `node_modules/.bin` on PATH (exit 127) — build via `npm run vercel-build`.
- DB: Neon via the Vercel Marketplace (free plan, iad1, resource
  `weather-slip-db`). `DATABASE_URL` = pooled host,
  `DATABASE_URL_UNPOOLED` = direct (migrate) — names the integration sets.
  `vercel.json` buildCommand runs `prisma migrate deploy` on every build.

## Not built yet / open

- **Phase 0 spike still open**: confirm on a dev store that the
  packing-slip and Order Printer Liquid read `weather_slip` metafields
  (and whether a `$app` namespace would also work — decide before launch,
  changing it later breaks every merchant's pasted snippet). Also check how
  often `shippingAddress.latitude/longitude` is populated.
- Order-details admin block, Pro backfill, heat/cold tags. (Billing and
  the print action extensions are built — see their sections above.)
- Partner app "Weather-Slip" (org ThePixelEdge): protected customer data
  declared 2026-10-12 (Store management + App functionality; Name, Phone,
  Address — not Email), and `shopify app deploy --config shopify.app.toml
  --allow-updates` released version weather-slip-2 the same day. Before App
  Store review: a privacy policy + merchant terms (the PCD form already
  answers "yes" to merchant data-protection agreements).
  Still needed: a separate staging app/toml.
- `shop.ianaTimezone` is captured on install and refreshed per job.

## Brand

`brand/icon.svg` is the app icon source (slip + forecast strip + sun and
cloud); `brand/icon-small.svg` is a simplified mark for favicons, because
the full icon is unreadable at 16–32px. `brand/export.sh` regenerates
`brand/icon-1200.png` (upload this in the Partner Dashboard — the CLI can't
set the app icon, and it's what the admin nav shows) and the `public/`
favicon/apple-touch/512 files.

## Verify

```bash
npm run typecheck && npm run lint && npm test
npx react-router build            # Node build
VERCEL=1 npx react-router build   # Vercel build output
```
Local DB: `docker start weather-slip-db` (port 55450, see `.env.example`).
Never point a local run or `prisma migrate dev` at the Neon production URL
— `.env.local` (pulled by `vercel env pull`) holds exactly that. Run Prisma
with `DATABASE_URL`/`DATABASE_URL_UNPOOLED` set inline to the local DB.
