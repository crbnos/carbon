// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env", () => ({
  CarbonEdition: "Community",
  CONTROLLED_ENVIRONMENT: false,
  DOMAIN: "localhost",
  SESSION_IDLE_LOCK_MS: 15 * 60 * 1000,
  SESSION_SECRET: "test-session-secret"
}));

// Import-safety only. `console-token.server` imports the cookie module for
// `consolePinMaxAgeMs` and `StoredConsolePinIn`; the cookie module imports the
// service-role client at the top level but nothing in these tests reaches it.
vi.mock("../lib/supabase/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));

import {
  refreshOperatorToken,
  signOperatorToken,
  signTerminalToken,
  terminalTokenMatches,
  verifyOperatorToken,
  verifyTerminalToken
} from "./console-token.server";

const COMPANY = "company-1";
const TERMINAL = "terminal-user";
const OTHER_SECRET = new TextEncoder().encode("not-the-session-secret");

const operator = () => ({
  userId: "operator-1",
  companyId: COMPANY,
  sessionUserId: TERMINAL,
  name: "Op One",
  avatarUrl: null,
  pinnedAt: Date.now()
});

/**
 * Flip one character of the signature; everything else stays byte-identical.
 * The FIRST character, not the last: a base64url-encoded 32-byte HMAC ends on
 * a character with two unused bits, so several values there decode to the same
 * signature and "tampering" it changes nothing.
 */
function tamperSignature(token: string) {
  const [header, payload, signature] = token.split(".");
  const flipped = `${signature!.startsWith("A") ? "B" : "A"}${signature!.slice(
    1
  )}`;
  return `${header}.${payload}.${flipped}`;
}

/** Re-sign an edited payload with a key we do not have. */
function forge(claims: Record<string, unknown>, audience: string) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("carbon")
    .setAudience(audience)
    .setIssuedAt()
    .sign(OTHER_SECRET);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("terminal token", () => {
  it("round-trips the company and the terminal session user", async () => {
    const token = await signTerminalToken({
      companyId: COMPANY,
      sessionUserId: TERMINAL
    });

    expect(await verifyTerminalToken(token)).toEqual({
      companyId: COMPANY,
      sessionUserId: TERMINAL
    });
  });

  it("matches only its own company and terminal session", async () => {
    const token = await signTerminalToken({
      companyId: COMPANY,
      sessionUserId: TERMINAL
    });

    expect(
      await terminalTokenMatches(token, {
        companyId: COMPANY,
        sessionUserId: TERMINAL
      })
    ).toBe(true);
    // Lifted onto a tablet signed in as someone else.
    expect(
      await terminalTokenMatches(token, {
        companyId: COMPANY,
        sessionUserId: "another-terminal"
      })
    ).toBe(false);
    // Replayed against another tenant.
    expect(
      await terminalTokenMatches(token, {
        companyId: "company-2",
        sessionUserId: TERMINAL
      })
    ).toBe(false);
    expect(
      await terminalTokenMatches(null, {
        companyId: COMPANY,
        sessionUserId: TERMINAL
      })
    ).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const token = await signTerminalToken({
      companyId: COMPANY,
      sessionUserId: TERMINAL
    });

    expect(await verifyTerminalToken(tamperSignature(token))).toBeNull();
  });

  it("rejects a payload re-signed with another key", async () => {
    const forged = await forge(
      { kind: "terminal", companyId: COMPANY, sessionUserId: TERMINAL },
      "carbon-console-terminal"
    );

    expect(await verifyTerminalToken(forged)).toBeNull();
  });

  it("rejects an operator token", async () => {
    const token = await signOperatorToken(operator());

    expect(await verifyTerminalToken(token)).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifyTerminalToken("")).toBeNull();
    expect(await verifyTerminalToken("not.a.jwt")).toBeNull();
  });
});

describe("operator token", () => {
  it("round-trips the whole pin-in claim", async () => {
    const stored = { ...operator(), avatarUrl: "https://example.test/a.png" };
    const token = await signOperatorToken(stored);

    expect(await verifyOperatorToken(token)).toEqual(stored);
  });

  it("expires after the pin-in window", async () => {
    const token = await signOperatorToken(operator());

    vi.setSystemTime(Date.now() + 59 * 60 * 1000);
    expect(await verifyOperatorToken(token)).not.toBeNull();

    vi.setSystemTime(Date.now() + 2 * 60 * 1000);
    expect(await verifyOperatorToken(token)).toBeNull();
  });

  it("a refresh slides the window without changing who is pinned in", async () => {
    const stored = operator();
    const token = await signOperatorToken(stored);

    vi.setSystemTime(Date.now() + 55 * 60 * 1000);
    const refreshed = await refreshOperatorToken(
      (await verifyOperatorToken(token))!
    );

    vi.setSystemTime(Date.now() + 30 * 60 * 1000);
    // The original has lapsed; the refreshed one carries the same operator.
    expect(await verifyOperatorToken(token)).toBeNull();
    expect(await verifyOperatorToken(refreshed)).toMatchObject({
      userId: stored.userId,
      companyId: stored.companyId,
      sessionUserId: stored.sessionUserId
    });
  });

  it("rejects a tampered signature", async () => {
    const token = await signOperatorToken(operator());

    expect(await verifyOperatorToken(tamperSignature(token))).toBeNull();
  });

  it("rejects a payload re-signed with another key", async () => {
    const stored = operator();
    const forged = await forge(
      { kind: "operator", ...stored, userId: "someone-else" },
      "carbon-console-operator"
    );

    expect(await verifyOperatorToken(forged)).toBeNull();
  });

  it("rejects a terminal token", async () => {
    const token = await signTerminalToken({
      companyId: COMPANY,
      sessionUserId: TERMINAL
    });

    expect(await verifyOperatorToken(token)).toBeNull();
  });

  it("rejects a token whose kind was swapped", async () => {
    // Signed by US (right key, right audience) but claiming the other kind, so
    // only the explicit `kind` check can refuse it.
    const token = await new SignJWT({ kind: "terminal", ...operator() })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("carbon")
      .setAudience("carbon-console-operator")
      .setIssuedAt()
      .setExpirationTime(new Date(Date.now() + 60 * 60 * 1000))
      .sign(new TextEncoder().encode("test-session-secret"));

    expect(await verifyOperatorToken(token)).toBeNull();
  });

  it("bounds a token with no expiry by the live policy window", async () => {
    const token = await new SignJWT({ kind: "operator", ...operator() })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("carbon")
      .setAudience("carbon-console-operator")
      .setIssuedAt()
      .sign(new TextEncoder().encode("test-session-secret"));

    // `pinnedAt` is still inside the window, so this passes the policy check —
    // what must refuse it is the window test against the stored pinnedAt once
    // it lapses. Prove the claim cannot outlive the policy even without `exp`.
    expect(await verifyOperatorToken(token)).not.toBeNull();
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    expect(await verifyOperatorToken(token)).toBeNull();
  });

  it("rejects a claim of the wrong shape", async () => {
    const token = await new SignJWT({
      kind: "operator",
      companyId: COMPANY,
      sessionUserId: TERMINAL,
      name: "Op One",
      avatarUrl: null,
      pinnedAt: Date.now()
      // no userId: there is nobody to attribute the work to
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("carbon")
      .setAudience("carbon-console-operator")
      .setIssuedAt()
      .setExpirationTime(new Date(Date.now() + 60 * 60 * 1000))
      .sign(new TextEncoder().encode("test-session-secret"));

    expect(await verifyOperatorToken(token)).toBeNull();
  });

  it("carries the company and terminal binding for the caller to check", async () => {
    // The token does not reject a foreign company itself — `requireApiUser`
    // compares these against the request. Pin that they survive the round trip,
    // because that comparison is only as good as what it reads.
    const token = await signOperatorToken({
      ...operator(),
      companyId: "company-2",
      sessionUserId: "another-terminal"
    });

    expect(await verifyOperatorToken(token)).toMatchObject({
      companyId: "company-2",
      sessionUserId: "another-terminal"
    });
  });
});

describe("controlled environment", () => {
  it("uses the idle-lock window instead of an hour", async () => {
    vi.resetModules();
    vi.doMock("../config/env", () => ({
      CarbonEdition: "Community",
      CONTROLLED_ENVIRONMENT: true,
      DOMAIN: "localhost",
      SESSION_IDLE_LOCK_MS: 15 * 60 * 1000,
      SESSION_SECRET: "test-session-secret"
    }));

    const itar = await import("./console-token.server");
    const token = await itar.signOperatorToken(operator());

    vi.setSystemTime(Date.now() + 14 * 60 * 1000);
    expect(await itar.verifyOperatorToken(token)).not.toBeNull();

    vi.setSystemTime(Date.now() + 2 * 60 * 1000);
    expect(await itar.verifyOperatorToken(token)).toBeNull();

    vi.doUnmock("../config/env");
    vi.resetModules();
  });
});
