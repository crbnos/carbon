// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  canAuthorizeForCompany,
  isAllowedRedirectUri,
  isRefreshTokenIdle,
  isRegisteredRedirectUri,
  supportedScope
} from "./oauth.server";

describe("isAllowedRedirectUri", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "http://localhost:33418/callback",
    "http://127.0.0.1:6274/oauth/callback",
    "http://[::1]:8080/cb",
    "cursor://anysphere.cursor-retrieval/oauth/callback",
    "com.example.app:/oauth2redirect"
  ])("accepts %s", (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(true);
  });

  it.each([
    "http://evil.example/callback",
    "http://localhost.evil.example/callback",
    "https://evil.example/cb#fragment",
    "https://user:pass@evil.example/cb",
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "ws://evil.example/cb",
    "myapp:callback",
    "not a url"
  ])("refuses %s", (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(false);
  });
});

describe("isRegisteredRedirectUri", () => {
  const registered = [
    "https://claude.ai/api/mcp/auth_callback",
    // Stored before /register checked redirect URIs.
    "http://evil.example/cb"
  ];

  it("accepts a registered, allowed URI", () => {
    expect(
      isRegisteredRedirectUri(
        registered,
        "https://claude.ai/api/mcp/auth_callback"
      )
    ).toBe(true);
  });

  it("refuses a URI the client did not register", () => {
    expect(isRegisteredRedirectUri(registered, "https://claude.ai/other")).toBe(
      false
    );
    expect(isRegisteredRedirectUri(registered, null)).toBe(false);
  });

  it("refuses a registered URI the rules no longer allow", () => {
    expect(isRegisteredRedirectUri(registered, "http://evil.example/cb")).toBe(
      false
    );
  });
});

describe("isRefreshTokenIdle", () => {
  const day = 24 * 3600 * 1000;
  const now = Date.parse("2026-10-12T12:00:00Z");
  // `expiresAt` is an hour after the last refresh.
  const lastRefreshed = (daysAgo: number) =>
    new Date(now - daysAgo * day + 3600 * 1000).toISOString();

  it("keeps a token refreshed within the last 30 days", () => {
    expect(isRefreshTokenIdle(lastRefreshed(0), now)).toBe(false);
    expect(isRefreshTokenIdle(lastRefreshed(29), now)).toBe(false);
  });

  it("retires a token unused for more than 30 days", () => {
    expect(isRefreshTokenIdle(lastRefreshed(31), now)).toBe(true);
  });
});

describe("supportedScope", () => {
  it("keeps only the scopes the server supports", () => {
    expect(supportedScope("mcp:tools admin:all")).toBe("mcp:tools");
    expect(supportedScope("mcp:tools mcp:tools")).toBe("mcp:tools");
  });

  it("returns null when nothing supported was requested", () => {
    expect(supportedScope("admin:all")).toBeNull();
    expect(supportedScope("")).toBeNull();
    expect(supportedScope(null)).toBeNull();
  });
});

describe("canAuthorizeForCompany", () => {
  const settingsAdminIn = (...companyIds: string[]) => ({
    settings: { view: companyIds, create: [], update: companyIds, delete: [] }
  });

  it("allows an employee holding settings_update in the selected company", () => {
    expect(
      canAuthorizeForCompany(
        { companyId: "c1", role: "employee" },
        settingsAdminIn("c1")
      )
    ).toBe(true);
  });

  // The session's active company is not the token's company: an admin of one
  // company could otherwise mint a connector for another where they are not.
  it("refuses when settings_update is held only in another company", () => {
    expect(
      canAuthorizeForCompany(
        { companyId: "c2", role: "employee" },
        settingsAdminIn("c1")
      )
    ).toBe(false);
  });

  it("refuses a customer or supplier portal account", () => {
    expect(
      canAuthorizeForCompany(
        { companyId: "c1", role: "customer" },
        settingsAdminIn("c1")
      )
    ).toBe(false);
  });
});
