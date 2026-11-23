// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  readConsolePinInCookieUnverified,
  setConsolePinActivity,
  setConsolePinIn
} from "./console-pin.server";

// The module reads its configuration once, at import, and builds a Supabase
// client there.
vi.hoisted(() => {
  vi.stubEnv("DOMAIN", "localhost");
  vi.stubEnv("CARBON_EDITION", "");
  vi.stubEnv("AUTH_COOKIE_SUFFIX", "");
  vi.stubEnv("CONTROLLED_ENVIRONMENT", "");
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  vi.stubEnv("SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
});

afterAll(() => vi.unstubAllEnvs());

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
    // The server's idle window, not a fixed browser cookie age, ends the pin-in.
    expect(cookie).not.toMatch(/Max-Age=/i);
    const read = await readConsolePinInCookieUnverified(
      requestWithCookie(cookieValue(cookie)),
      companyId,
      terminal
    );
    expect(read).toMatchObject(operator);
    expect(read?.pinId).toEqual(expect.any(String));
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

  it("renews activity without reissuing the operator identity", async () => {
    const identity = cookieValue(
      await setConsolePinIn(companyId, terminal, operator)
    );
    const initial = await readConsolePinInCookieUnverified(
      requestWithCookie(identity),
      companyId,
      terminal
    );
    expect(initial).not.toBeNull();

    vi.setSystemTime(Date.now() + 50 * 60 * 1000);
    const activity = cookieValue(
      await setConsolePinActivity(companyId, terminal, initial!.pinId)
    );
    vi.setSystemTime(Date.now() + 20 * 60 * 1000);
    const renewed = await readConsolePinInCookieUnverified(
      requestWithCookie(`${identity}; ${activity}`),
      companyId,
      terminal
    );
    expect(renewed).toMatchObject({
      userId: operator.userId,
      pinnedAt: operator.pinnedAt + 50 * 60 * 1000
    });
  });

  it("ignores a delayed heartbeat from the previous operator", async () => {
    const oldIdentity = cookieValue(
      await setConsolePinIn(companyId, terminal, operator)
    );
    const oldPin = await readConsolePinInCookieUnverified(
      requestWithCookie(oldIdentity),
      companyId,
      terminal
    );
    const delayedActivity = cookieValue(
      await setConsolePinActivity(companyId, terminal, oldPin!.pinId)
    );

    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    const nextOperator = {
      ...operator,
      userId: "operator-2",
      pinnedAt: Date.now()
    };
    const newIdentity = cookieValue(
      await setConsolePinIn(companyId, terminal, nextOperator)
    );
    const current = await readConsolePinInCookieUnverified(
      requestWithCookie(`${newIdentity}; ${delayedActivity}`),
      companyId,
      terminal
    );
    expect(current).toMatchObject(nextOperator);
    expect(current?.pinId).not.toBe(oldPin?.pinId);
  });
});
