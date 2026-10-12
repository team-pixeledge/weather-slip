# Weather Slip

Shopify app that prints packing slips with the destination's weather
forecast, and saves that weather on the order (current temperature plus
dispatch-day and delivery-day forecasts) so Shopify's own packing slip,
invoices and order emails can print it too. Plans count orders printed with
weather — once per order, reprints are free — not API calls.

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

1. Vercel team "Test" (Hobby for now — see CLAUDE.md), project connected to
   this repo.
2. Neon from the Vercel Marketplace (sets `DATABASE_URL` and
   `DATABASE_URL_UNPOOLED`).
3. Set `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`,
   `OPENWEATHER_API_KEYS`, `ENCRYPTION_KEY`, `CRON_SECRET`.
4. Put the Vercel URL in `shopify.app.toml` and run `npm run deploy`.

Migrations run on every Vercel build (`vercel.json`). Add GitHub repo
secrets `APP_URL` and `CRON_SECRET` for the 10-minute queue workflow.

## Commands

| | |
|---|---|
| `npm test` | unit tests (dates, snapshot, formatting, OpenWeather aggregation) |
| `npm run typecheck` / `npm run lint` | |
| `npm run worker` | long-running queue worker (local / future AWS) |
