import { describe, expect, it } from "vitest";
import { buildIntegrationOAuthUrl } from "./integration-oauth";

describe("integration OAuth URL", () => {
  it("requires a server-issued state", async () => {
    expect(
      buildIntegrationOAuthUrl(
        {
          authUrl: "https://provider.example.com/authorize",
          clientId: "client-1",
          redirectUri: "/api/integrations/ramp/oauth",
          scopes: ["accounting:read"]
        },
        undefined,
        "https://erp.example.com"
      )
    ).toBeNull();
  });

  it("includes the issued state and canonical callback parameters", async () => {
    const result = buildIntegrationOAuthUrl(
      {
        authUrl: "https://provider.example.com/authorize",
        clientId: "client-1",
        redirectUri: "/api/integrations/ramp/oauth",
        scopes: ["accounting:read", "offline_access"]
      },
      "server-state",
      "https://erp.example.com"
    );
    const url = new URL(result!);

    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://erp.example.com/api/integrations/ramp/oauth"
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("server-state");
    expect(url.searchParams.get("scope")).toBe(
      "accounting:read offline_access"
    );
  });
});
