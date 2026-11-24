// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildIntegrationOAuthUrl,
  pickXeroConnection,
  xeroAuthEventId
} from "./integration-oauth";

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

describe("pickXeroConnection", () => {
  const jwt = (claims: object) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
  const connections = [
    { id: "c-old", authEventId: "evt-1", tenantId: "t-us", tenantName: "US" },
    { id: "c-new", authEventId: "evt-2", tenantId: "t-uk", tenantName: "UK" }
  ];

  it("reads the auth event id from the access token", () => {
    expect(xeroAuthEventId(jwt({ authentication_event_id: "evt-2" }))).toBe(
      "evt-2"
    );
    expect(xeroAuthEventId("not-a-jwt")).toBeNull();
  });

  it("takes the organisation picked in this authorisation, not the first listed", () => {
    expect(pickXeroConnection(connections, "evt-2")?.tenantId).toBe("t-uk");
  });

  it("falls back to the first connection when the event is unknown", () => {
    expect(pickXeroConnection(connections, null)?.tenantId).toBe("t-us");
    expect(pickXeroConnection([], "evt-2")).toBeNull();
  });
});
