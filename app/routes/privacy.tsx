// Public privacy policy (Shopify App Store requirement), served at /privacy
// as plain HTML: no layout, no scripts, no cookies, no Shopify auth.
//
// Keep it true to what the app does. If stored data, sub-processors or
// retention change (prisma/schema.prisma, compliance webhooks, Sentry,
// weather provider), update this page and LAST_UPDATED in the same commit —
// the App Store listing and the protected customer data answers point here.

const LAST_UPDATED = "20 October 2026";
const CONTACT = "teampixeledge@gmail.com";

const BODY = `
<h1>Weather Slip — Privacy Policy</h1>
<p class="meta">Last updated: ${LAST_UPDATED}</p>

<p>Weather Slip is a Shopify app made by ThePixelEdge ("we", "us"). It prints
packing slips that show the weather forecast at an order's destination. This
policy explains what data the app reads, what it stores, why, and for how
long. It applies to merchants who install the app and to their customers
whose orders are printed with it.</p>

<h2>Our role</h2>
<p>For your customers' data, you (the merchant) are the controller and we act
as your processor: we only use it to provide the app's features to you. For
your own store account data, we are the controller.</p>

<h2>Data we read from Shopify</h2>
<ul>
  <li><strong>Orders:</strong> order number and ID, dates, line items,
  prices, payment and fulfilment status, tags, notes, and the shipping and
  billing address, customer name and phone — so they can be printed on the
  packing slip.</li>
  <li><strong>Products:</strong> images, SKU, barcode and compare-at price,
  for the slip.</li>
  <li><strong>Store:</strong> store name, logo, locations and timezone, and
  the store owner's name and email (only when we send you a usage
  email).</li>
</ul>

<h2>Customer data we do <em>not</em> store</h2>
<p>Customer names, street addresses, phone numbers and emails are read from
Shopify only while a slip is being printed and are never saved by Weather
Slip. The printed slip is generated for your browser and is not kept on our
servers.</p>

<h2>Data we store</h2>
<ul>
  <li><strong>Per printed order:</strong> order ID and number, the
  destination city and country code, a location rounded to about 11 km, a
  one-way fingerprint of the address (to notice when it changes), dispatch
  and delivery dates, the weather forecast, and print counts and dates. The
  same forecast is saved on the order in your Shopify store as app
  metafields.</li>
  <li><strong>Per store:</strong> the shop domain, your app settings and
  slip design, your plan and usage counts, the shop timezone, your logo URL,
  and the access tokens Shopify issues to the app (the Storefront token is
  encrypted).</li>
  <li><strong>Weather cache:</strong> forecasts per rounded location (no
  order or customer data), kept for 3 hours; looked-up city coordinates are
  kept for up to 30 days.</li>
</ul>
<p>We do not sell personal data, use it for advertising or profiling, or
combine it with data from other stores. The app does not change your
storefront and sets no tracking or advertising cookies.</p>

<h2>Why we use it</h2>
<ul>
  <li>To print packing slips and customer lists you ask for.</li>
  <li>To look up and save the forecast for an order's destination.</li>
  <li>To count prints against your plan and bill through Shopify.</li>
  <li>To email you about your usage and to keep the service running and
  secure.</li>
</ul>

<h2>Service providers</h2>
<ul>
  <li><strong>Shopify</strong> — the platform the app runs on, and billing.</li>
  <li><strong>Amazon Web Services</strong> — app hosting (United States).</li>
  <li><strong>Neon</strong> — database hosting on AWS (United States).</li>
  <li><strong>OpenWeather</strong> — weather forecasts and city lookup.
  It receives only a city, postcode, country or rounded coordinates, never
  a name, street, phone or email.</li>
  <li><strong>Sentry</strong> — error reports, so we can fix problems.
  Reports contain technical details and order or shop IDs; request bodies,
  addresses and other customer details are removed before sending.</li>
  <li><strong>An email delivery provider</strong> — to send usage and
  service emails to the store owner.</li>
</ul>
<p>Data is stored and processed in the United States. Providers process it
only on our instructions and under their own security and data protection
terms.</p>

<h2>How long we keep it</h2>
<ul>
  <li>Order weather data is kept while the app is installed, so reprints
  match. When Shopify tells us to erase a customer's data
  (<code>customers/redact</code>), we delete the weather data for those
  orders and remove our metafields from them.</li>
  <li>When you uninstall, we stop processing and delete pending work. When
  Shopify sends <code>shop/redact</code> (48 hours after uninstall), we
  delete everything we hold for your store.</li>
  <li>Error reports are deleted by Sentry after its retention period
  (currently up to 90 days).</li>
</ul>

<h2>Your rights and your customers' rights</h2>
<p>Customers who want to access, correct or delete their data should contact
the store they bought from; the store can do this through Shopify, which
notifies us. We answer Shopify's data requests
(<code>customers/data_request</code>) with what we hold for those orders.
Merchants can contact us at any time to ask about, export or delete their
data. Depending on where you live (for example under the GDPR or CCPA), you
may also have the right to object, restrict processing or complain to your
data protection authority.</p>

<h2>Security</h2>
<p>All connections use HTTPS/TLS. The database is encrypted at rest, stored
tokens are encrypted, Shopify webhooks are verified by signature, and access
to production systems is limited to the people who run the app.</p>

<h2>Changes</h2>
<p>We will update this page when the app's data handling changes and change
the date above.</p>

<h2>Contact</h2>
<p>ThePixelEdge — <a href="mailto:${CONTACT}">${CONTACT}</a></p>
`;

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy Policy — Weather Slip</title>
<meta name="description" content="How the Weather Slip Shopify app handles merchant and customer data.">
<link rel="icon" href="/favicon.ico">
<style>
  :root { color-scheme: light dark; --bg: #ffffff; --fg: #1f2328; --muted: #59636e; --line: #d1d9e0; --link: #0969da; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #3d444d; --link: #4493f8; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 1.9rem; line-height: 1.25; margin: 0 0 4px; }
  h2 { font-size: 1.2rem; margin: 2rem 0 .5rem; padding-top: 1rem; border-top: 1px solid var(--line); }
  .meta { color: var(--muted); margin-top: 0; }
  a { color: var(--link); }
  code { font-size: .9em; }
  li { margin: .35rem 0; }
</style>
</head>
<body><main>${BODY}</main></body>
</html>`;

export const loader = () =>
  new Response(HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
