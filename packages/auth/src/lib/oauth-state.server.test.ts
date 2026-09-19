import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env", () => ({
  CarbonEdition: "Community",
  DOMAIN: "localhost",
  SESSION_SECRET: "test-session-secret"
}));

import { consumeOAuthState, issueOAuthState } from "./oauth-state.server";

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
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);

    const consumed = await consumeOAuthState(
      requestWithCookie(issued.cookie),
      issued.state,
      expected
    );

    expect(consumed.valid).toBe(false);
  });
});
