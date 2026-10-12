# Weather Slip

Shopify app that saves destination weather on every order — current
temperature plus dispatch-day and delivery-day forecasts — so it prints on
packing slips, invoices and order emails. Weather is saved once per order,
so reprints always match.

Architecture, design rules and open items: see [CLAUDE.md](CLAUDE.md).

## Local setup

```bash
npm install
cp .env.example .env            # fill OPENWEATHER_API_KEYS, ENCRYPTION_KEY, CRON_SECRET
docker run -d --name weather-slip-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=weather_slip -p 55450:5432 postgres:16-alpine
npx prisma migrate deploy
npm test
```

Running against a store needs the Partner Dashboard app first:
`npm run config:link`, then `npm run dev` (temporarily set
`automatically_update_urls_on_dev = true` locally — never commit it), and
`npm run worker` in a second terminal to process queued orders.

## Deploy (Vercel)

1. Import the repo in Vercel (Pro plan — see CLAUDE.md for why).
2. Create a Neon database; set `DATABASE_URL` (pooled) and `DIRECT_URL`.
3. Set `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`,
   `OPENWEATHER_API_KEYS`, `ENCRYPTION_KEY`, `CRON_SECRET`.
4. Put the Vercel URL in `shopify.app.toml` and run `npm run deploy`.

Migrations run on every Vercel build (`vercel.json`).

## Commands

| | |
|---|---|
| `npm test` | unit tests (dates, snapshot, formatting, OpenWeather aggregation) |
| `npm run typecheck` / `npm run lint` | |
| `npm run worker` | long-running queue worker (local / future AWS) |
