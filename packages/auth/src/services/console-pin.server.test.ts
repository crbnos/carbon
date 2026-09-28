import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env", () => ({
  CarbonEdition: "Community",
  CONTROLLED_ENVIRONMENT: false,
  DOMAIN: "localhost",
  SESSION_IDLE_LOCK_MS: 15 * 60 * 1000,
  SESSION_SECRET: "test-session-secret"
}));

// Import-safety only: these tests exercise the cookie (real react-router
// signing); the database re-validation in `resolveConsolePinIn` is not faked.
vi.mock("../lib/supabase/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));

import {
  readConsolePinInCookieUnverified,
  setConsolePinIn
} from "./console-pin.server";

const companyId = "company-1";
const terminal = "terminal-user";
const operator = {
  userId: "operator-1",
  name: "Op One",
  avatarUrl: null,
  pinnedAt: 0
};

function cookieValue(setCookie: string) {
  return setCookie.split(";")[0]!;
}

function requestWithCookie(cookie: string) {
  return new Request("http://localhost/x/operations", {
    headers: { Cookie: cookie }
  });
}

describe("console pin-in cookie", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    operator.pinnedAt = Date.now();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips a signed pin-in", async () => {
    const cookie = await setConsolePinIn(companyId, terminal, operator);
    expect(cookie).toMatch(/HttpOnly/i);
    const read = await readConsolePinInCookieUnverified(
      requestWithCookie(cookieValue(cookie)),
      companyId,
      terminal
    );
    expect(read).toEqual(operator);
  });

  it("rejects a hand-crafted unsigned (legacy) cookie", async () => {
    const forged = encodeURIComponent(
      JSON.stringify({ ...operator, userId: "someone-else" })
    );
    const read = await readConsolePinInCookieUnverified(
      requestWithCookie(`console-pin-${companyId}=${forged}`),
      companyId,
      terminal
    );
    expect(read).toBeNull();
  });

  // The two tests around this one send values react-router cannot decode, so
  // they read as null with or without a signature. This one is exactly what an
  // UNSIGNED cookie would serialize to — correct shape, company, terminal and
  // a fresh pinnedAt — so only the missing signature can reject it.
  it("rejects a well-formed unsigned cookie naming another operator", async () => {
    const forged = encodeURIComponent(
      btoa(
        JSON.stringify({
          ...operator,
          userId: "someone-else",
          companyId,
          sessionUserId: terminal,
          pinnedAt: Date.now()
        })
      )
    );
    const read = await readConsolePinInCookieUnverified(
      requestWithCookie(`console-pin-${companyId}=${forged}`),
      companyId,
      terminal
    );
    expect(read).toBeNull();
  });

  it("rejects a signed cookie whose payload was edited", async () => {
    const cookie = cookieValue(
      await setConsolePinIn(companyId, terminal, operator)
    );
    const [name, value] = cookie.split("=");
    const [payload, signature] = decodeURIComponent(value!).split(".");
    const edited = btoa(
      JSON.stringify({
        ...JSON.parse(atob(payload!)),
        userId: "someone-else"
      })
    );
    const read = await readConsolePinInCookieUnverified(
      requestWithCookie(
        `${name}=${encodeURIComponent(`${edited}.${signature}`)}`
      ),
      companyId,
      terminal
    );
    expect(read).toBeNull();
  });

  it("is bound to the company and the terminal session user", async () => {
    const cookie = cookieValue(
      await setConsolePinIn(companyId, terminal, operator)
    );
    // Renamed to another company's cookie name: the signature still verifies
    // (it covers the value only), the embedded companyId does not.
    const renamed = cookie.replace(
      `console-pin-${companyId}`,
      "console-pin-company-2"
    );
    expect(
      await readConsolePinInCookieUnverified(
        requestWithCookie(renamed),
        "company-2",
        terminal
      )
    ).toBeNull();
    expect(
      await readConsolePinInCookieUnverified(
        requestWithCookie(cookie),
        companyId,
        "another-terminal"
      )
    ).toBeNull();
  });

  it("expires after the idle window", async () => {
    const cookie = cookieValue(
      await setConsolePinIn(companyId, terminal, operator)
    );
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    expect(
      await readConsolePinInCookieUnverified(
        requestWithCookie(cookie),
        companyId,
        terminal
      )
    ).toBeNull();
  });
});
