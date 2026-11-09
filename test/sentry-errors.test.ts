import { describe, expect, it } from "vitest";
import { errorMessage, toError } from "../app/lib/sentry.server";

describe("toError", () => {
  it("keeps Errors as they are", () => {
    const e = new Error("boom");
    expect(toError(e)).toBe(e);
  });

  it("names the status of a thrown Response instead of [object Response]", () => {
    const e = toError(new Response(undefined, { status: 500, statusText: "Internal Server Error" }));
    expect(e.name).toBe("ShopifyResponseError");
    expect(e.message).toBe(
      "Shopify library threw a Response: HTTP 500 Internal Server Error (likely an offline access-token refresh failure)",
    );
  });

  it("doesn't blame the token refresh for other statuses", () => {
    expect(errorMessage(new Response("{}", { status: 429 }))).toBe("Shopify library threw a Response: HTTP 429");
  });

  it("stringifies anything else", () => {
    expect(errorMessage("plain")).toBe("plain");
  });
});
