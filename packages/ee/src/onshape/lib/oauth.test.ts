import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/env", () => ({
  getAppUrl: () => "https://itar.carbon.ms",
  ONSHAPE_CLIENT_ID: "public-client",
  ONSHAPE_CLIENT_SECRET: "public-secret",
  ONSHAPE_OAUTH_REDIRECT_URL:
    "https://app.carbon.ms/api/integrations/onshape/oauth"
}));

import {
  hasOnshapeIntegration,
  isOnshapeIntegrationId,
  normalizeOnshapeUrl
} from "./connection";
import { getOnshapeAuthorizeUrl, getOnshapeOAuthConfig } from "./oauth";

const government = {
  baseUrl: "https://acme.onshape.example",
  oauthUrl: "https://oauth.onshape.example",
  clientId: "gov-client",
  clientSecret: "gov-secret"
};

describe("normalizeOnshapeUrl", () => {
  it("reduces a typed tenant address to its https origin", () => {
    expect(normalizeOnshapeUrl("acme.onshape.example")).toBe(
      "https://acme.onshape.example"
    );
    expect(
      normalizeOnshapeUrl("  https://acme.onshape.example/documents?x=1 ")
    ).toBe("https://acme.onshape.example");
  });

  it("refuses anything that would send tokens without TLS", () => {
    expect(normalizeOnshapeUrl("http://acme.onshape.example")).toBeNull();
    expect(normalizeOnshapeUrl("")).toBeNull();
    expect(normalizeOnshapeUrl(undefined)).toBeNull();
  });
});

describe("getOnshapeOAuthConfig", () => {
  it("uses this instance's public app for the standard integration", () => {
    expect(getOnshapeOAuthConfig("onshape", {})).toEqual({
      clientId: "public-client",
      clientSecret: "public-secret",
      redirectUri: "https://app.carbon.ms/api/integrations/onshape/oauth",
      baseUrl: "https://cad.onshape.com",
      authorizeUrl: "https://oauth.onshape.com/oauth/authorize",
      tokenUrl: "https://oauth.onshape.com/oauth/token"
    });
  });

  it("uses the customer's private app and tenant for Government", () => {
    expect(getOnshapeOAuthConfig("onshape-government", government)).toEqual({
      clientId: "gov-client",
      clientSecret: "gov-secret",
      redirectUri:
        "https://itar.carbon.ms/api/integrations/onshape-government/oauth",
      baseUrl: "https://acme.onshape.example",
      authorizeUrl: "https://oauth.onshape.example/oauth/authorize",
      tokenUrl: "https://oauth.onshape.example/oauth/token"
    });
  });

  it("is unconfigured until every Government field is present", () => {
    for (const key of Object.keys(government)) {
      expect(
        getOnshapeOAuthConfig("onshape-government", {
          ...government,
          [key]: ""
        })
      ).toBeNull();
    }
  });
});

describe("getOnshapeAuthorizeUrl", () => {
  it("targets the connection's own OAuth server with space-delimited scopes", () => {
    const config = getOnshapeOAuthConfig("onshape-government", government)!;
    const url = new URL(getOnshapeAuthorizeUrl(config, "state-123"));
    expect(url.origin + url.pathname).toBe(
      "https://oauth.onshape.example/oauth/authorize"
    );
    expect(url.searchParams.get("client_id")).toBe("gov-client");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.search).toContain("scope=OAuth2Read%20OAuth2Write");
  });
});

describe("integration identity", () => {
  it("recognises both Onshape integrations and nothing else", () => {
    expect(isOnshapeIntegrationId("onshape")).toBe(true);
    expect(isOnshapeIntegrationId("onshape-government")).toBe(true);
    expect(isOnshapeIntegrationId("jira")).toBe(false);
    expect(hasOnshapeIntegration(new Set(["onshape-government"]))).toBe(true);
    expect(hasOnshapeIntegration(new Set(["jira"]))).toBe(false);
  });
});
