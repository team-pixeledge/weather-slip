@AGENTS.md

# Weather Slip — project notes

Read before exploring. Update when something architecturally significant
changes; don't let it drift.

## What this is

Shopify **public** embedded app: saves destination weather (current +
dispatch-day + delivery-day forecast) on each order as order metafields, so
packing slips, invoices and emails can print it with one Liquid line.
Free (30 orders) / Starter $4.99 (500) / Pro $9.99 (2,000) / Business $19.99 (5,000) — `app/lib/plans.ts` (2026-10-13). Scaffolded 2026-10-12
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
  merchant Refresh, or a pending-date fill. Fulfillment **freezes** the
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
- **Plans count orders, not API calls** (user decision 2026-10-12): an
  order counts once, ever, the first time a merchant action gets it weather
  — printing its slip with a usable destination, or Refresh. Reprints, later
  months, address changes and pending fills never count. `countOrder`
  (`shop.server.ts`) inserts the `CountedOrder (shop, orderId)` row and takes
  `consumeUsage` in one transaction; at the limit the row rolls back so the
  order can be counted later. Jobs: CREATE/REFRESH may count, ADDRESS_CHANGE/
  PENDING_FILL only proceed for already-counted orders. Verified on a local
  DB: reprint free, 4 concurrent prints of one order → 1 count, refused at
  50/50 with no row left, counted after the period resets. Migration
  `counted_orders` backfills orders that already had weather.

## Orders page + printed packing slips (added 2026-10-12)

The Orders page is the app home (`/app`, `rel="home"` in the nav, so the admin sidebar shows no separate Orders item; `/` and `/app/orders` redirect to it — there's no public landing page). It lists the shop's orders live from Shopify, laid out like
Shopify's own Orders page on purpose (user request: familiar + compact):
same tabs (All, Unfulfilled, Unpaid, Open, Archived), columns (Order, Date,
Customer, Channel, Total, Payment/Fulfillment badges, Items, Delivery
method, Tags) plus Weather; bulk print actions replace the filter row while
orders are selected; 25/50/100/250 rows a page (`?per=`, default 50); it
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
  Shopify's Print menu — uses that: no weather/geocode API call, no usage,
  identical slip. Only "ok" forecasts are saved, so a limit-reached or
  no-address print can still get weather later. The slip reuses the
  snapshot's dispatch/delivery dates when one exists.
- **Plan limits on print:** each order with a usable destination goes
  through `countOrder` (no destination → no weather, no count); refused →
  the slip prints "plan limit reached" instead of weather. An order without
  saved weather then gets a CREATE/REFRESH job (it's already counted, so the
  job doesn't count it again).
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
the preview counts an order's usage, same as printing from the app.

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
