// A made-up order for the Packing slip page's live preview. Pure (no
// server imports) so the preview renders in the browser with the same
// renderer the print tab uses. Dates are relative to today so the
// forecast strip always looks current.
import { addDays } from "./dates";
import type { PrintOrder, PrintShop } from "./orders.server";
import type { SlipWeather } from "./slip";

export function sampleSlipData(today: string, shopName: string) {
  const shop: PrintShop = {
    name: shopName,
    contactEmail: "hello@your-store.example",
    ianaTimezone: "UTC",
    primaryDomain: { host: "your-store.example" },
    shopAddress: { address1: "12 Market Street", city: "Austin", province: "TX", zip: "78701", country: "United States" },
  };
  const order: PrintOrder = {
    id: "gid://shopify/Order/1",
    name: "#1042",
    createdAt: `${today}T09:30:00Z`,
    note: "Please leave the parcel in the shade.",
    phone: null,
    email: "jordan.lee@example.com",
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    shippingLine: { title: "Express (2–3 days)" },
    shippingAddress: {
      name: "Jordan Lee",
      address1: "118 Elm Street",
      address2: "Apt 4",
      city: "Denver",
      province: "Colorado",
      zip: "80202",
      country: "United States",
      countryCodeV2: "US",
      phone: "+1 303 555 0100",
    },
    billingAddress: {
      name: "Jordan Lee",
      address1: "118 Elm Street",
      city: "Denver",
      province: "Colorado",
      zip: "80202",
      country: "United States",
    },
    fulfillments: [],
    currencyCode: "USD",
    currentSubtotalPriceSet: { shopMoney: { amount: "84.00" } },
    currentTotalDiscountsSet: { shopMoney: { amount: "0" } },
    totalShippingPriceSet: { shopMoney: { amount: "9.50" } },
    currentTotalTaxSet: { shopMoney: { amount: "6.72" } },
    currentTotalPriceSet: { shopMoney: { amount: "100.22" } },
    lineItems: {
      nodes: [
        {
          id: "1",
          name: "Live plant — Monstera (large)",
          sku: "PLT-MON-L",
          variantTitle: "Large",
          quantity: 1,
          unfulfilledQuantity: 1,
          originalUnitPriceSet: { shopMoney: { amount: "54.00" } },
          image: null,
        },
        {
          id: "2",
          name: "Organic potting mix 5L",
          sku: "SOIL-5",
          variantTitle: null,
          quantity: 2,
          unfulfilledQuantity: 2,
          originalUnitPriceSet: { shopMoney: { amount: "15.00" } },
          image: null,
        },
      ],
    },
  };
  const labels = ["Clear sky", "Few clouds", "Light rain", "Moderate rain", "Overcast clouds"];
  const weather: SlipWeather = {
    status: "ok",
    city: "Denver",
    countryCode: "US",
    dispatch: addDays(today, 1),
    delivery: addDays(today, 3),
    current: { tempC: 18.4, label: "Few clouds" },
    days: labels.map((label, i) => ({
      date: addDays(today, i),
      minC: 7 + i,
      maxC: 21 - i,
      precipProb: i === 2 || i === 3 ? 60 + i * 5 : 10,
      label,
    })),
    horizonEnd: addDays(today, 4),
    asOf: `${today}T09:30:00Z`,
  };
  return { shop, order, weather: new Map([["1", weather]]) };
}
