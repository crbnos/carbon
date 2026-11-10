// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env", () => ({
  AUTH_COOKIE_SUFFIX: undefined,
  CarbonEdition: "Community",
  DOMAIN: "localhost",
  SESSION_SECRET: "test-session-secret"
}));

import { isSignInBrowser, markSignInBrowser } from "./sign-in-browser.server";

const requestWith = (cookie?: string) =>
  new Request("http://localhost/magic-link?token=x", {
    headers: cookie ? { Cookie: cookie } : {}
  });

describe("sign-in browser", () => {
  afterEach(() => vi.useRealTimers());

  it("is the browser that asked, for the link's hour, and no other", async () => {
    const cookie = (await markSignInBrowser()).split(";")[0]!;
    expect(await isSignInBrowser(requestWith(cookie))).toBe(true);
    // A mail sandbox opening the link: no cookie.
    expect(await isSignInBrowser(requestWith())).toBe(false);
    // A cookie that was not signed with the secret.
    expect(await isSignInBrowser(requestWith("carbon-sign-in=e30%3D"))).toBe(
      false
    );
  });

  it("stops once the link has expired", async () => {
    const cookie = (await markSignInBrowser()).split(";")[0]!;
    vi.useFakeTimers({ now: Date.now() + 61 * 60 * 1000 });
    expect(await isSignInBrowser(requestWith(cookie))).toBe(false);
  });
});

describe("sign-in browser without a shared DOMAIN", () => {
  it("binds nothing, so an MES link still completes on the ERP", async () => {
    vi.resetModules();
    vi.doMock("../config/env", () => ({
      AUTH_COOKIE_SUFFIX: undefined,
      CarbonEdition: "Community",
      DOMAIN: undefined,
      SESSION_SECRET: "test-session-secret"
    }));
    const warn = vi.fn();
    vi.doMock("@carbon/logger", () => ({ getLogger: () => ({ warn }) }));
    const unbound = await import("./sign-in-browser.server");
    expect(await unbound.isSignInBrowser(requestWith())).toBe(true);
    expect(await unbound.isSignInBrowser(requestWith())).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    vi.doUnmock("../config/env");
    vi.doUnmock("@carbon/logger");
  });
});
