// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { afterEach, describe, expect, it, vi } from "vitest";

// The sync app and the panel app, each set or unset per test.
const env = vi.hoisted(() => {
  const configured = {
    ONSHAPE_CLIENT_ID: "public-client",
    ONSHAPE_CLIENT_SECRET: "public-secret",
    ONSHAPE_OAUTH_REDIRECT_URL:
      "https://app.carbon.ms/api/integrations/onshape/oauth",
    ONSHAPE_V2_CLIENT_ID: "panel-client",
    ONSHAPE_V2_CLIENT_SECRET: "panel-secret",
    ONSHAPE_V2_OAUTH_REDIRECT_URL:
      "https://app.carbon.ms/api/integrations/onshape-v2/oauth"
  };
  return {
    configured,
    current: { ...configured } as Partial<typeof configured>
  };
});

vi.mock("@carbon/env", () => ({
  getAppUrl: () => "https://itar.carbon.ms",
  get ONSHAPE_CLIENT_ID() {
    return env.current.ONSHAPE_CLIENT_ID;
  },
  get ONSHAPE_CLIENT_SECRET() {
    return env.current.ONSHAPE_CLIENT_SECRET;
  },
  get ONSHAPE_OAUTH_REDIRECT_URL() {
    return env.current.ONSHAPE_OAUTH_REDIRECT_URL;
  },
  get ONSHAPE_V2_CLIENT_ID() {
    return env.current.ONSHAPE_V2_CLIENT_ID;
  },
  get ONSHAPE_V2_CLIENT_SECRET() {
    return env.current.ONSHAPE_V2_CLIENT_SECRET;
  },
  get ONSHAPE_V2_OAUTH_REDIRECT_URL() {
    return env.current.ONSHAPE_V2_OAUTH_REDIRECT_URL;
  }
}));

import {
  hasOnshapeIntegration,
  isOnshapeIntegrationId,
  normalizeOnshapeUrl
} from "./connection";
import { getOnshapeAuthorizeUrl, getOnshapeOAuthConfig } from "./oauth";

const government = {
  baseUrl: "https://acme.onshape.example",
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
  afterEach(() => {
    env.current = { ...env.configured };
  });

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

  it("uses the panel's own app for Onshape V2", () => {
    expect(getOnshapeOAuthConfig("onshape-v2", {})).toEqual({
      clientId: "panel-client",
      clientSecret: "panel-secret",
      redirectUri: "https://app.carbon.ms/api/integrations/onshape-v2/oauth",
      baseUrl: "https://cad.onshape.com",
      authorizeUrl: "https://oauth.onshape.com/oauth/authorize",
      tokenUrl: "https://oauth.onshape.com/oauth/token"
    });
  });

  it("never lends the sync app's client to the panel", () => {
    env.current = {
      ONSHAPE_CLIENT_ID: env.configured.ONSHAPE_CLIENT_ID,
      ONSHAPE_CLIENT_SECRET: env.configured.ONSHAPE_CLIENT_SECRET,
      ONSHAPE_OAUTH_REDIRECT_URL: env.configured.ONSHAPE_OAUTH_REDIRECT_URL,
      ONSHAPE_V2_OAUTH_REDIRECT_URL:
        env.configured.ONSHAPE_V2_OAUTH_REDIRECT_URL
    };
    expect(getOnshapeOAuthConfig("onshape-v2", {})).toBeNull();
    expect(getOnshapeOAuthConfig("onshape", {})?.clientId).toBe(
      "public-client"
    );
  });

  it("never lends the panel's client to the sync integration", () => {
    env.current = {
      ONSHAPE_OAUTH_REDIRECT_URL: env.configured.ONSHAPE_OAUTH_REDIRECT_URL,
      ONSHAPE_V2_CLIENT_ID: env.configured.ONSHAPE_V2_CLIENT_ID,
      ONSHAPE_V2_CLIENT_SECRET: env.configured.ONSHAPE_V2_CLIENT_SECRET,
      ONSHAPE_V2_OAUTH_REDIRECT_URL:
        env.configured.ONSHAPE_V2_OAUTH_REDIRECT_URL
    };
    expect(getOnshapeOAuthConfig("onshape", {})).toBeNull();
    expect(getOnshapeOAuthConfig("onshape-v2", {})?.clientId).toBe(
      "panel-client"
    );
  });

  it("uses the customer's private app and tenant for Government", () => {
    expect(getOnshapeOAuthConfig("onshape-government", government)).toEqual({
      clientId: "gov-client",
      clientSecret: "gov-secret",
      redirectUri:
        "https://itar.carbon.ms/api/integrations/onshape-government/oauth",
      baseUrl: "https://acme.onshape.example",
      authorizeUrl: "https://acme.onshape.example/oauth/authorize",
      tokenUrl: "https://acme.onshape.example/oauth/token"
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
  it("targets the Government tenant's own address with space-delimited scopes", () => {
    const config = getOnshapeOAuthConfig("onshape-government", government)!;
    const url = new URL(getOnshapeAuthorizeUrl(config, "state-123"));
    expect(url.origin + url.pathname).toBe(
      "https://acme.onshape.example/oauth/authorize"
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
