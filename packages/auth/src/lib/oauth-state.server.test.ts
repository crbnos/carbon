import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env", () => ({
  CarbonEdition: "Community",
  DOMAIN: "localhost",
  SESSION_SECRET: "test-session-secret"
}));

import {
  consumeOAuthState,
  issueOAuthState,
  issueOAuthStates
} from "./oauth-state.server";

/** The cookie value (name=value) from a Set-Cookie header, as a browser sends it. */
function cookieHeader(setCookie: string) {
  return setCookie.split(";")[0]!;
}

function requestWithCookie(cookie: string) {
  return new Request("http://localhost/api/integrations/ramp/oauth", {
    headers: { Cookie: cookie }
  });
}

const expected = {
  integrationId: "ramp",
  userId: "user-1",
  companyId: "company-1"
};

describe("OAuth state session", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips the nonce and binds it to the integration, user, and company", async () => {
    const issued = await issueOAuthState(expected);
    const consumed = await consumeOAuthState(
      requestWithCookie(issued.cookie),
      issued.state,
      expected
    );

    expect(consumed.valid).toBe(true);
  });

  it("rejects a replay after the state has been consumed", async () => {
    const issued = await issueOAuthState(expected);
    const consumed = await consumeOAuthState(
      requestWithCookie(issued.cookie),
      issued.state,
      expected
    );
    const replay = await consumeOAuthState(
      requestWithCookie(consumed.cookie),
      issued.state,
      expected
    );

    expect(consumed.valid).toBe(true);
    expect(replay.valid).toBe(false);
  });

  it.each([
    ["nonce", { state: "wrong-state", expected }],
    [
      "integration",
      { state: null, expected: { ...expected, integrationId: "xero" } }
    ],
    ["user", { state: null, expected: { ...expected, userId: "user-2" } }],
    [
      "company",
      { state: null, expected: { ...expected, companyId: "company-2" } }
    ]
  ])("rejects a mismatched %s", async (_label, mismatch) => {
    const issued = await issueOAuthState(expected);
    const consumed = await consumeOAuthState(
      requestWithCookie(issued.cookie),
      mismatch.state ?? issued.state,
      mismatch.expected
    );

    expect(consumed.valid).toBe(false);
  });

  it("rejects an expired state", async () => {
    const issued = await issueOAuthState(expected);
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);

    const consumed = await consumeOAuthState(
      requestWithCookie(issued.cookie),
      issued.state,
      expected
    );

    expect(consumed.valid).toBe(false);
  });

  it("keeps one pending state per integration", async () => {
    const onshape = { ...expected, integrationId: "onshape" };
    const ramp = await issueOAuthState(expected);
    const both = await issueOAuthState(
      onshape,
      requestWithCookie(cookieHeader(ramp.cookie))
    );

    const onshapeConsumed = await consumeOAuthState(
      requestWithCookie(cookieHeader(both.cookie)),
      both.state,
      onshape
    );
    const rampConsumed = await consumeOAuthState(
      requestWithCookie(cookieHeader(onshapeConsumed.cookie)),
      ramp.state,
      expected
    );

    expect(onshapeConsumed.valid).toBe(true);
    expect(rampConsumed.valid).toBe(true);
  });

  it("issues several states in one cookie", async () => {
    const payloads = ["ramp", "xero", "jira"].map((integrationId) => ({
      ...expected,
      integrationId
    }));
    const issued = await issueOAuthStates(null, payloads);

    for (const payload of payloads) {
      const consumed = await consumeOAuthState(
        requestWithCookie(cookieHeader(issued.cookie)),
        issued.states[payload.integrationId]!,
        payload
      );
      expect(consumed.valid).toBe(true);
    }
  });

  it("does not accept one integration's state for another", async () => {
    const issued = await issueOAuthStates(null, [
      expected,
      { ...expected, integrationId: "xero" }
    ]);

    const consumed = await consumeOAuthState(
      requestWithCookie(cookieHeader(issued.cookie)),
      issued.states.ramp!,
      { ...expected, integrationId: "xero" }
    );

    expect(consumed.valid).toBe(false);
  });

  it("reuses a still-fresh state so a second page load does not invalidate the first", async () => {
    const first = await issueOAuthState(expected);
    vi.advanceTimersByTime(60 * 1000);
    const second = await issueOAuthState(
      expected,
      requestWithCookie(cookieHeader(first.cookie))
    );

    expect(second.state).toBe(first.state);
  });

  it("replaces a state bound to a different user instead of reusing it", async () => {
    const first = await issueOAuthState(expected);
    const second = await issueOAuthState(
      { ...expected, userId: "user-2" },
      requestWithCookie(cookieHeader(first.cookie))
    );

    expect(second.state).not.toBe(first.state);
  });

  it("rejects an empty state even when one is stored", async () => {
    const issued = await issueOAuthState(expected);
    const consumed = await consumeOAuthState(
      requestWithCookie(cookieHeader(issued.cookie)),
      "",
      expected
    );

    expect(consumed.valid).toBe(false);
  });
});
