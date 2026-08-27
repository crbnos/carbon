import { describe, expect, it, vi } from "vitest";

// Read by NAME off the allowlist row, so the mock is a bag of env vars rather
// than fixed exports — that indirection is the thing under test.
const ENV: Record<string, string | undefined> = {
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_OAUTH_REDIRECT_URL:
    "https://erp.test/api/integrations/connections/callback"
};

vi.mock("@carbon/env", () => ({
  getEnv: (name: string) => ENV[name]
}));

const { resolveOAuthApp } = await import("./oauth");

describe("resolveOAuthApp", () => {
  it("reads the app from the env vars the allowlist row names", () => {
    expect(resolveOAuthApp("google-calendar")).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUrl: "https://erp.test/api/integrations/connections/callback"
    });
  });

  it("refuses a piece that is not allowlisted", () => {
    expect(() => resolveOAuthApp("slack")).toThrow(
      "No OAuth app is configured for slack."
    );
  });

  it("refuses when the server has not configured the app", () => {
    ENV.GOOGLE_OAUTH_CLIENT_SECRET = undefined;
    try {
      // A half-configured vendor must fail here, not send the customer to a
      // consent screen that cannot come back.
      expect(() => resolveOAuthApp("google-calendar")).toThrow(
        "No OAuth app is configured for google-calendar."
      );
    } finally {
      ENV.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
    }
  });
});
