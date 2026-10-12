// Order metafield location the invoice/packing-slip snippets read from.
// A plain (non-$app) namespace on purpose: Phase 0 still has to confirm that
// packing-slip and Order Printer Liquid can read app-reserved namespaces. If
// they can, moving to $app would stop other apps from overwriting these —
// but every merchant's pasted snippet would need updating, so decide before
// launch, not after.
export const METAFIELD_NAMESPACE = "weather_slip";
export const METAFIELD_SUMMARY_KEY = "summary";
export const METAFIELD_SNAPSHOT_KEY = "snapshot";
// The full multi-day forecast printed on the app's own slips, saved on the
// order at its first print so every reprint shows the same weather without
// calling the weather API again.
export const METAFIELD_FORECAST_KEY = "forecast";
