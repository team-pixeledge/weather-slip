# Weather Slip

A public Shopify app by ThePixelEdge. It prints packing slips with the
weather forecast at the order's destination, with the dispatch and delivery
days marked and rain, frost or heat flagged. The forecast is fetched the first
time an order's slip is printed and saved on the order as a metafield. Every
reprint shows the same forecast, and so do Shopify's own packing slip, Order
Printer and order emails, through a Liquid snippet. Plans count slips printed
with weather (reprints included; the same order again within 10 minutes is
free), not API calls.

- **Production:** https://weatherslip.thepixeledge.in
- **Privacy policy:** https://weatherslip.thepixeledge.in/privacy
- **Marketing pages:** https://thepixeledge.in/weather-slip/ (overview, install and setup guide, pricing, FAQ)
- **Architecture, design rules and the reasons behind decisions:** [CLAUDE.md](CLAUDE.md)
- **App Store listing copy and submission checklist:** [docs/app-store-listing.md](docs/app-store-listing.md)

> This repository is **public**. Never commit secrets, `.env*` files,
> database URLs or account IDs. Secrets live only in the places listed under
> [Where secrets live](#where-secrets-live).

## Technology stack

| Layer | What we use |
|---|---|
| Language / runtime | TypeScript, Node.js 22 |
| Framework | React Router 7 (SSR), from Shopify's `shopify-app-template-react-router` |
| Shopify | `@shopify/shopify-app-react-router` (OAuth, sessions, webhooks, Billing API), Admin GraphQL API 2026-10, App Bridge, Polaris web components |
| Shopify extensions | Order **print actions** (single and bulk "Weather slip"), a **Shopify Flow action** ("Save weather on order") and a Flow template (`extensions/`) |
| Database | PostgreSQL via Prisma 6 (`prisma/schema.prisma`, migrations in `prisma/migrations`) |
| Background work | Postgres-backed job queue (`WeatherJob`, `FOR UPDATE SKIP LOCKED`) drained by a long-running worker (`scripts/worker.ts`) |
| Weather data | OpenWeather (forecast and geocoding). Open-Meteo is supported as an alternative provider |
| Printing | Plain HTML slips rendered server-side (`app/lib/slip.ts`), which the merchant's browser prints or saves as a PDF |
| Error tracking | Sentry (`@sentry/node`, errors only, personal data stripped) |
| Logging | pino JSON logs to stdout (worker and queue), `console` elsewhere |
| Email | Nodemailer over SMTP: operator alerts and merchant usage emails |
| Tests / quality | Vitest, ESLint, `tsc` |
| Container | Docker (multi-stage, `Dockerfile`), one image for both web and worker |
| CI/CD | GitHub Actions (production deploy) and Vercel Git integration (staging) |

## Environments

There are two completely separate environments. They share no app, server,
database or keys.

| | **Production** | **Staging / testing** |
|---|---|---|
| Git branch | `prod` | `main` |
| Shopify app (Partner Dashboard) | **Weather-Slip** (`shopify.app.toml`) | **Weather-Slip-Staging** (`shopify.app.staging.toml`) |
| URL | https://weatherslip.thepixeledge.in | https://weather-slip.vercel.app |
| Hosting | AWS Lightsail container service `weather-slip` (us-east-1) | Vercel project `weather-slip` (Hobby) |
| Database | Neon project `weather-slip-prod` (ThePixelEdge org, AWS us-east-1) | Neon DB `weather-slip-db` (Vercel integration) |
| Deploys | Push to `prod` → GitHub Actions → Lightsail | Push to `main` → Vercel |
| Background queue | `worker` container, always on | Daily Vercel cron (`/api/cron/drain`) and inline draining |
| Errors | Sentry project `weather-slip` | Not sent to Sentry |

To install on a development store: `https://admin.shopify.com/store/<store>/oauth/install?client_id=<client_id from the toml>`.
Until the App Store listing is approved, only development stores in the
ThePixelEdge Partner organization can install it.

## Services and where to log in

| Service | Used for | Login |
|---|---|---|
| Shopify Partner Dashboard | Both apps, protected customer data, App Store listing, distribution | https://partners.shopify.com |
| Shopify Dev Dashboard | App versions, client ID / secret, test installs | https://dev.shopify.com/dashboard |
| AWS console (dedicated Weather Slip account, team **teamPixelEdge**) | Lightsail hosting, SSM Parameter Store (production env), IAM, billing | https://console.aws.amazon.com · Lightsail: https://lightsail.aws.amazon.com |
| Neon | Production database (`weather-slip-prod`) | https://console.neon.tech |
| Vercel (team "Test") | Staging hosting and its Neon database | https://vercel.com/dashboard |
| GitHub | Source code (`team-pixeledge/weather-slip`), Actions deploy runs | https://github.com/team-pixeledge/weather-slip |
| Sentry (org `thepixeledge`) | Error tracking and alert emails | https://thepixeledge.sentry.io |
| OpenWeather | Weather API keys and usage | https://home.openweathermap.org |
| GoDaddy | DNS for `thepixeledge.in` (`weatherslip` CNAME and the certificate validation CNAME) | https://dcc.godaddy.com |
| Shopify Flow (in each store's admin) | Testing the "Save weather on order" action | Shopify admin → Apps → Flow |

Free tiers and credits:
- AWS runs on credits until 2027-04-19. Upgrade the account to a paid plan before then, or the account closes.
- Sentry stays on the free Developer plan (errors only, no card).
- Neon and OpenWeather are on their free plans.
- Vercel Hobby is non-commercial, so upgrade it before staging is used commercially.

## Where secrets live

| Environment | Location |
|---|---|
| Production | AWS SSM Parameter Store, `/weather-slip/prod/*` (SecureString). The deploy workflow reads them when it deploys, so after changing one, rerun the workflow. |
| Staging | Vercel → project → Settings → Environment Variables |
| Local | `.env` (git-ignored), copied from `.env.example` |
| GitHub → AWS | No keys. GitHub OIDC assumes the IAM role `weather-slip-github-deploy`, which only trusts the `prod` branch. |

Variables: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`,
`SCOPES`, `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct, used
for migrations), `WEATHER_PROVIDER`, `OPENWEATHER_API_KEYS`,
`ENCRYPTION_KEY`, `CRON_SECRET`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`,
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SENTRY_DSN`
(production only). `SENTRY_RELEASE` is set by the workflow.

## Repository layout

```
app/
  routes/          pages (app.*), print tabs (print.*), webhooks, /privacy, /healthz, /api/cron/drain
  lib/             orders, slips, weather providers, queue, billing, plans, alerts, Sentry, logger
extensions/        print actions and the Shopify Flow action
prisma/            schema and migrations
scripts/worker.ts  queue worker (production `worker` container, local dev)
scripts/aws/       one-time AWS setup (Lightsail service, OIDC role, SSM env)
.github/workflows/ deploy-prod.yml
docs/              App Store listing
brand/             app icon sources
```

## Local development

```bash
npm install
cp .env.example .env            # fill OPENWEATHER_API_KEYS, ENCRYPTION_KEY, CRON_SECRET
docker run -d --name weather-slip-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=weather_slip -p 55450:5432 postgres:16-alpine
npx prisma migrate deploy
npm test
```

To run against a dev store, use the **staging** app:

```bash
npx shopify app dev --config staging   # never with the production config
npm run worker                         # second terminal: processes queued jobs
```

`automatically_update_urls_on_dev` is `false` in both config files. Set it to
`true` locally only while you run `dev`, and never commit it: while dev runs,
it points the staging app at your local tunnel.

Never point a local run or `prisma migrate dev` at a Neon URL. Both Neon
databases are real.

## Deploying

**Production (AWS):** merge into `prod` and push. `.github/workflows/deploy-prod.yml` then:
1. builds the Docker image (linux/amd64);
2. pushes it to Lightsail;
3. creates a deployment with two containers: `web` (runs `prisma migrate deploy`, then the server) and `worker`;
4. waits for `/healthz`.

Shopify config, scopes, webhooks and extensions are released separately:

```bash
npx shopify app deploy --config shopify.app.toml           # production app
npx shopify app deploy --config shopify.app.staging.toml   # staging app
```

**Staging (Vercel):** push to `main`. Vercel builds with `npm run vercel-build`, which runs the migrations, and skips the `prod` branch.

## Monitoring

- **Sentry** emails on every new or regressed error, and on new high-priority issues.
- **Operator alert emails** (`app/lib/alerts.server.ts`, to `ALERT_EMAIL_TO`) cover:
  - server errors;
  - the weather API failing or nearing its monthly limit;
  - queue jobs that give up;
  - print and billing failures.

  Repeats are throttled to one email per hour.
- **Logs:**
  - production: Lightsail console → `weather-slip` → Logs, or `aws lightsail get-container-log --service-name weather-slip --container-name web|worker`;
  - staging: Vercel → Logs.
- **Health check:** `GET /healthz` (no DB query). Point an external uptime monitor, such as UptimeRobot's free plan, at it to be emailed if the whole server goes down.

## Commands

| Command | |
|---|---|
| `npm test` | unit tests (Vitest) |
| `npm run typecheck` / `npm run lint` | type and lint checks |
| `npm run worker` | queue worker |
| `npm run build` | production server build |
| `VERCEL=1 npx react-router build` | Vercel build output |
