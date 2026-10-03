// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/v1/auth/code` — what the ROUTE decides, with the shared sign-in
 * gates stubbed (they talk to Redis, Postgres and SMTP).
 *
 * The decision worth pinning is that a device never takes the DEV_BYPASS_EMAIL
 * shortcut. `requestSignInCode` answers `bypass` for that account so the WEB
 * login action can mint a session cookie on the spot; this route has no cookie
 * to mint, so honouring it meant answering `{ ok: true }` and sending nothing.
 * The developer's own account — the one their browser is signed in with —
 * could never sign in on a phone, so the phone ended up on a second account in
 * a different company, showing a different company's work centers.
 */

const { requestSignInCode, limit } = vi.hoisted(() => ({
  requestSignInCode: vi.fn(),
  limit: vi.fn()
}));

// The real `@carbon/auth` graph reaches `@carbon/content`, whose glossary needs
// the Lingui macro transform this vitest config does not run.
vi.mock("@carbon/auth", () => ({
  APP_REVIEW_EMAILS: ["reviewer@example.com"],
  getMESUrl: () => "http://mes.test"
}));

vi.mock("@carbon/auth/api-user.server", () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
      readonly fields?: Record<string, string[]>,
      readonly details?: unknown
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    // `apiRoute` stamps every success response with this; a factory mock that
    // omits an export makes vitest throw on access, which surfaced as a 500.
    API_VERSIONS_HEADER: "carbon-api",
    apiErrorResponse: (err: ApiError) =>
      new Response(
        JSON.stringify({
          error: {
            code: err.code,
            message: err.message,
            ...(err.details !== undefined && { details: err.details })
          }
        }),
        {
          status: err.status,
          headers: { "Content-Type": "application/json", "carbon-api": "1" }
        }
      ),
    requireApiUser: vi.fn()
  };
});

vi.mock("~/services/auth.server", () => ({ requestSignInCode }));
vi.mock("./lib/ratelimit.server", () => ({
  authIpRatelimit: { limit },
  signInLockout: () => ({ tag: "lockout" })
}));

const route = await import("./auth.code");

type RouteFn = (args: {
  request: Request;
  params: Record<string, string | undefined>;
  context: unknown;
}) => Promise<Response>;

const post = (body: unknown) =>
  (route.action as unknown as RouteFn)({
    request: new Request("http://mes.test/api/v1/auth/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    params: {},
    context: {}
  });

beforeEach(() => {
  vi.clearAllMocks();
  limit.mockResolvedValue({ success: true });
  requestSignInCode.mockResolvedValue({ kind: "sent" });
});

describe("POST /api/v1/auth/code", () => {
  it("never takes the dev bypass, so every account gets a real code", async () => {
    const response = await post({ email: "Dev@Carbon.ms" });

    expect(response.status).toBe(200);
    expect(requestSignInCode).toHaveBeenCalledWith(
      expect.objectContaining({
        // Normalised before the gates see it.
        email: "dev@carbon.ms",
        channel: "mobile",
        // The line under test. Without it the bypass account is answered
        // `{ ok: true }` and no email is ever sent.
        allowBypass: false
      })
    );
  });

  it("answers identically whether or not the account exists", async () => {
    // The public surface must not be a user-enumeration oracle.
    const sent = await (await post({ email: "a@example.com" })).json();
    requestSignInCode.mockResolvedValue({ kind: "unknown_user" });
    const unknown = await (await post({ email: "b@example.com" })).json();
    requestSignInCode.mockResolvedValue({ kind: "error", message: "smtp" });
    const failed = await (await post({ email: "c@example.com" })).json();

    expect(sent).toEqual({ ok: true });
    expect(unknown).toEqual(sent);
    expect(failed).toEqual(sent);
  });

  it("gives a store-review account a password field, and sends it no code", async () => {
    const response = await post({ email: "reviewer@example.com" });

    expect(await response.json()).toEqual({ ok: true, method: "password" });
    expect(requestSignInCode).not.toHaveBeenCalled();
  });

  it("says so when the domain requires single sign-on", async () => {
    requestSignInCode.mockResolvedValue({ kind: "sso_required" });

    const response = await post({ email: "a@example.com" });

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("sso_required");
  });

  it("reports a lockout with how long it lasts", async () => {
    requestSignInCode.mockResolvedValue({
      kind: "locked",
      retryAfterSeconds: 600
    });

    const response = await post({ email: "a@example.com" });

    expect(response.status).toBe(429);
    const payload = await response.json();
    expect(payload.error.code).toBe("locked");
    expect(payload.error.details).toEqual({ retryAfterSeconds: 600 });
  });

  it("refuses before the gates run when the IP is over its limit", async () => {
    limit.mockResolvedValue({ success: false });

    const response = await post({ email: "a@example.com" });

    expect(response.status).toBe(429);
    expect(requestSignInCode).not.toHaveBeenCalled();
  });

  it("rejects a body that is not an email", async () => {
    const response = await post({ email: "not-an-email" });

    expect(response.status).toBe(400);
    expect(requestSignInCode).not.toHaveBeenCalled();
  });
});
