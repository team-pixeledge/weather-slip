@AGENTS.md

# Weather Slip — project notes

Read before exploring. Update when something architecturally significant
changes; don't let it drift.

## What this is

Shopify **public** embedded app: saves destination weather (current +
dispatch-day + delivery-day forecast) on each order as order metafields, so
packing slips, invoices and emails can print it with one Liquid line.
Free / Starter $4.99 / Pro $9.99 (`app/lib/plans.ts`). Scaffolded 2026-10-12
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
  `/app/orders` fetches weather and enqueues a CREATE job that writes the
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

`/app/orders` lists the shop's orders live from Shopify (views Unfulfilled
= open + unfulfilled/partial, On hold, All open; search is Shopify's own
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
- **Slip weather is the live forecast at print time** (shared 3h cache),
  every day from today at the destination to the provider horizon, with
  dispatch/delivery outlined (`slip.ts`, pure + tested). It deliberately
  doesn't touch the saved metafield snapshot, which still follows the
  "reprints never change" rule; the slip reuses the snapshot's
  dispatch/delivery dates when one exists so the two agree.
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
- Pro merchants may save their own key (AES-256-GCM, `ENCRYPTION_KEY`); it
  is tried first, ours behind it.
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
    retries, pending fills, pruning. Called every 10 min by GitHub Actions
    (`.github/workflows/drain-queue.yml`, repo secrets `APP_URL` +
    `CRON_SECRET`) and daily by Vercel Cron as a backstop (`vercel.json`).
- **Vercel team "Test" (`test11-fc37`, account teampixeledge-1075) is on
  Hobby** (user decision 2026-10-12, budget). Hobby crons run at most daily,
  hence the GitHub Actions scheduler. Hobby's terms are non-commercial:
  upgrade to Pro before charging merchants, then set `vercel.json` back to
  `*/10` and delete the workflow. GitHub disables scheduled workflows after
  60 days without commits.
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
- Billing API wiring (plans are enforced from `Shop.plan`, which nothing
  sets yet besides the default FREE), print action extension (would put
  "Weather slip" in Shopify's own Orders → Print menu; the in-app Orders
  page covers printing until then), order-details
  admin block, Pro backfill, heat/cold tags.
- Partner app "Weather-Slip" (org ThePixelEdge) is linked, but **`shopify
  app deploy` is blocked** until protected customer data access is
  declared in the Partner Dashboard (orders webhooks carry PCD). Request
  only what we use: Level 1 + name, address and phone (the printed slips
  need all three; never email). Then rerun
  `shopify app deploy --config shopify.app.toml --allow-updates`.
  Still needed: a separate staging app/toml.
- `shop.ianaTimezone` is captured on install and refreshed per job.

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
