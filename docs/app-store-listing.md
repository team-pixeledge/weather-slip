# App Store listing — Weather Slip

Copy for the Partner Dashboard → Distribution → App Store listing (English).
Written from the app's real behaviour and `app/lib/plans.ts` (2026-10-14,
rechecked 2026-10-20).

**Submit from the production app only:** Partner app **Weather-Slip**
(client_id `dccbe8c9a0ab78e67bc78132e8466d36`, `shopify.app.toml`,
https://weatherslip.thepixeledge.in). Weather-Slip-Staging is for testing
and is never listed.
If plans, limits or features change, update **Pricing** and the feature
lines here and in the listing — a listing that doesn't match the app is a
common rejection reason.

Wording rules for this listing (and any ad copy):

- **Never "live", "real-time" or "up-to-date" weather.** The forecast is
  fetched when an order's slip is first printed (or Shopify Flow saves it)
  and saved on the order; reprints show that saved forecast. Say "forecast
  saved on the order", "at the time of printing".
- **Never "16-day" or "2-week" forecasts.** The OpenWeather free plan gives
  today + 4 days (`horizonDays = 4`). Raise this only after moving to a paid
  OpenWeather plan and the 16-day endpoint.
- **Credit the data source**: "Weather data © OpenWeather" (ODbL; their
  terms require visible attribution where the data is shown — the app
  prints it on every slip and in the Shopify snippet; the listing and FAQ
  name it too).
- Distance is a straight line, not a route distance.

## Before submitting (checklist)

1. `npx shopify app deploy --config shopify.app.toml` released on the
   production app (URLs, webhooks, scopes, print/Flow extensions).
2. Protected customer data declared on the production app: Name, Address,
   Phone (not Email), Store management + App functionality.
3. Installed and tested on a development store from the production app
   (the review steps below, end to end).
4. Privacy policy published at a public URL (see Support & links) — a hard
   requirement; the listing can't be submitted without it.
5. App icon uploaded (`brand/icon-1200.png`), 3–6 screenshots, optional
   screencast.
6. Emergency developer contact and support email set in the Partner
   Dashboard.
7. Vercel upgraded to Pro if staging is ever used commercially (Hobby is
   non-commercial); production itself runs on AWS.

## Basic app information

| Field | Value |
|---|---|
| App name (≤30) | Weather Slip |
| App icon | `brand/icon-1200.png` (1200×1200) |
| Primary category | Orders and shipping › Fulfilling orders › Order printing (closest fit: packing slips) |
| Languages | English (app); printed slips in English, French, German, Spanish, Italian, Portuguese, Dutch |
| Works with | Shopify Flow, Shopify packing slips, Shopify Order Printer, Order Printer Pro |

## App store listing content

**App introduction** (≤100)

> Print packing slips with the destination's weather forecast for dispatch and delivery day.

**App details** (≤500)

> Weather Slip prints packing slips that show the weather forecast at your customer's city — today plus up to the next 4 days (by plan), with dispatch and delivery days marked and rain, frost or heat flagged. The forecast is fetched once, when an order's slip is first printed, and saved on the order, so every reprint matches. Print one slip or many from the app or Shopify's Orders page, or add the weather to Shopify's own packing slip. Weather data © OpenWeather.

**Feature list** (each ≤80)

1. Destination forecast on packing slips, saved on the order at first print
2. Rain, frost and heat warnings for dispatch and delivery day
3. 4 templates incl. a 4×6 / 4×4 shipping label, with your logo and colours
4. Print one slip or many, from the app or from Shopify's Orders page
5. Slips in 7 languages, an order barcode, and distance to the customer

**Search terms** (up to 5)

packing slip · weather forecast · shipping label · order printer · delivery weather

## Media

Desktop screenshots: 1600×900, 3–6 images, app UI only. Use the sample
order (Packing slip page preview) — no real customer names or addresses.
Crop out the browser bar. Suggested set, in order:

1. Packing slip page — Classic template preview with the forecast cards and a warning badge
2. Orders page — orders selected, "Print packing slips" in the bulk bar
3. A printed slip (Minimal or Shipping label template) showing the forecast table and the "Weather data © OpenWeather" line
4. Packing slip settings — logo, language, weather options
5. Plans page — plan cards (prices must match **Pricing** below)

## Pricing

Billed through Shopify, monthly or yearly. No free trial (none is configured
in `billing.server.ts` — don't list one). Every slip printed with weather
counts, reprints included (the same order again within 10 minutes is free).
Allowance resets every 30 days on monthly and yearly billing alike.

| Plan | Monthly | Yearly | Includes |
|---|---|---|---|
| Free | $0 | — | 30 slip prints/month with weather · forecast today + 2 days · Classic template · unfulfilled orders · logo, fonts, colours, paper sizes · weather on Shopify's own packing slip |
| Starter | $4.99 | $49 | 500 slip prints/month · forecast today + 2 days · everything in Free · Minimal (ink-saver) template · dispatch-day forecast in saved weather · print from Shopify's Orders page · customer list printout · Order Printer & Order Printer Pro setup guide · watermark (PAID, FRAGILE, GIFT…) |
| Pro | $9.99 | $99 | 2,000 slip prints/month · forecast today + 3 days · everything in Starter · Detailed template with prices · all order views (fulfilled, unpaid, cancelled, archived) · slips in 7 languages · distance to the customer · Shopify Flow action · watermark with your own text |
| Business | $19.99 | $199 | 5,000 slip prints/month · forecast today + 4 days · everything in Pro · 4×6 / 4×4 shipping label template · logo watermark · remove the Weather Slip mark from prints |

At the limit, slips still print, without weather. The shop owner gets an
email at 80% and 100%.

## FAQ / weather data source (listing FAQ, if offered)

> **Where does the weather come from?** Weather data © OpenWeather
> (openweathermap.org), used under the Open Database License (ODbL). The
> forecast is for the order's shipping city, fetched when the slip is first
> printed and saved on the order. It isn't live weather; reprints show the
> saved forecast.

## Support & links

| Field | Value |
|---|---|
| Support email | teampixeledge@gmail.com (confirm) |
| Privacy policy URL | **TODO — required before submitting** (must describe: order city/country, ~11 km location and forecast stored; name, address, phone read only at print time and never stored; deletion on customers/redact and shop/redact) |
| Terms / merchant agreement | **TODO** (the protected customer data form already answers "yes" to merchant data-protection agreements) |
| Documentation / setup guide | TODO (or point to the in-app "How to use" + FAQ on the Plans page) |

## Data and permissions (for the listing's data section and the reviewer)

- **Protected customer data (Level 2):** Name, Address, Phone, for Store
  management + App functionality. Declared 2026-10-12 on the old app (now
  Weather-Slip-Staging); **must be declared again on the production app**. Read from Shopify
  only while rendering a print and never stored. Email is **not** declared
  (see the open question in the hand-off).
- **Stored per printed order:** city, country code, a location rounded to
  0.1° (~11 km), an address hash (to detect changes), dispatch/delivery
  dates and the forecast; the same weather is saved on the order as
  `weather_slip` metafields.
- **Compliance webhooks** (`/webhooks/compliance`, HMAC-verified):
  `customers/data_request` emails the operator what's held for the requested
  orders; `customers/redact` deletes those orders' snapshots, jobs and
  `weather_slip` metafields; `shop/redact` deletes everything for the shop.

## App review instructions (for the Shopify reviewer)

> **What the app does:** prints packing slips (and an optional customer list) that include the weather forecast at the order's destination. The forecast is fetched from OpenWeather when an order's slip is first printed and saved on the order as a metafield, so reprints — and Shopify's own packing slip, if the merchant adds our snippet — show the same forecast. It doesn't change the storefront or theme.
>
> **To test:**
> 1. Install the app on a development store (charges there are always test charges, so any plan can be approved at no cost; Business shows every feature).
> 2. Create an order with a shipping address (any real city). POS and local-pickup orders aren't listed — they have no address to forecast.
> 3. **Orders** (app home): select the order and click **Print packing slips**. A new tab opens with the slip — the forecast for the destination city, dispatch and delivery days marked, and "Weather data © OpenWeather" under the forecast. Print again: the same saved forecast is reused and the order isn't counted twice.
> 4. **Packing slip**: change template, language, logo and weather options and watch the preview. **Settings**: temperature unit and handling/transit days (they set the dispatch and delivery dates).
> 5. In Shopify's own **Orders** page, open an order → **More actions → Print → Weather slip** (Starter and up).
> 6. **Shopify templates**: the Liquid snippet for Shopify's packing slip / Order Printer. **Plans**: switch plans; the FAQ is on the same page.
> 7. Optional (Pro+): in Shopify Flow, "Order paid" → Weather Slip "Save weather on order".
>
> **Permissions:** read_orders — order list and shipping city/coordinates for the forecast; name, address and phone are printed on slips but not stored. write_orders — save the forecast on the order as a metafield. read_products — compare-at price and barcode on slips. unauthenticated_read_content, read_themes, read_files — the store logo for the slip header. read_locations, read_merchant_managed_fulfillment_orders, read_third_party_fulfillment_orders — the location an order ships from, for the optional straight-line distance.
>
> **Contact:** teampixeledge@gmail.com

Screencast: record install → plan → create order → print → reprint (same
forecast) → Packing slip settings → Print from Shopify's Orders page.
