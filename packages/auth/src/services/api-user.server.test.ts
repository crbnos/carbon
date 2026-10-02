// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Isolation mocks ───────────────────────────────────────────────────────
// api-user.server's siblings pull in supabase + env at module load. Stub them
// so the token / company / permission / MFA / operator logic runs on its own.
// vi.mock factories are hoisted above the module body, so the shared spy has
// to be created with vi.hoisted or it is still undefined when the factory runs.
const { limitMock } = vi.hoisted(() => ({
  limitMock: vi.fn<() => Promise<{ success: boolean }>>()
}));

vi.mock("@carbon/kv", () => {
  class Ratelimit {
    static slidingWindow() {
      return { kind: "slidingWindow" };
    }
    limit = limitMock;
  }
  return {
    redis: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(null)
    },
    Ratelimit
  };
});

vi.mock("../config/env", () => ({
  SESSION_SECRET: "test-session-secret",
  SUPABASE_URL: "http://localhost:54321",
  CONTROLLED_ENVIRONMENT: false
}));

vi.mock("../lib/supabase/client", () => ({
  getCarbon: vi.fn((token: string) => ({ token }))
}));

vi.mock("../lib/supabase/client.server", () => ({
  getCarbonServiceRole: vi.fn(() => ({}))
}));

vi.mock("./auth.server", () => ({
  getAuthAccountByAccessToken: vi.fn()
}));

vi.mock("./mfa.server", () => ({
  userHasVerifiedTotpFactor: vi.fn().mockResolvedValue(false)
}));

vi.mock("./auth-events.server", () => ({
  logAuthEvent: vi.fn()
}));

vi.mock("./users", () => ({
  getClaims: vi.fn(),
  makePermissionsFromClaims: vi.fn()
}));

import type { ApiClaims, ApiOperator, ApiUserDeps } from "./api-user.server";
import { ApiError, apiErrorResponse, requireApiUser } from "./api-user.server";

const COMPANY = "comp_1";
const USER = "user_1";
const OPERATOR = "user_2";

/** A token decodeJwt can read. Signature is never checked by this module. */
function token(payload: Record<string, unknown> = {}) {
  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

const employeeClaims: ApiClaims = {
  role: "employee",
  permissions: {
    production: {
      view: [COMPANY],
      create: [COMPANY],
      update: [COMPANY],
      delete: []
    },
    // Granted in a DIFFERENT company only — the exact-companyId match must
    // refuse it here, exactly as requirePermissions' session loop does.
    quality: { view: ["other"], create: ["other"], update: [], delete: [] }
  }
};

function deps(overrides: Partial<ApiUserDeps> = {}): ApiUserDeps {
  return {
    getUser: vi
      .fn()
      .mockResolvedValue({ id: USER, email: "op@example.com" }) as never,
    getClaims: vi.fn().mockResolvedValue(employeeClaims),
    hasTotp: vi.fn().mockResolvedValue(false) as never,
    rateLimit: vi.fn().mockResolvedValue(true),
    ...overrides
  };
}

function request(
  headers: Record<string, string> = {},
  url = "http://mes.test/api/v1/operations"
) {
  return new Request(url, { headers });
}

const authed = {
  authorization: `Bearer ${token({ aal: "aal1" })}`,
  "x-carbon-company": COMPANY
};

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
    return "no-error";
  } catch (err) {
    if (err instanceof ApiError) return `${err.status}:${err.code}`;
    throw err;
  }
}

beforeEach(() => {
  limitMock.mockReset();
  limitMock.mockResolvedValue({ success: true });
});

describe("requireApiUser — token", () => {
  it("refuses a request with no Authorization header", async () => {
    expect(await codeOf(requireApiUser(request(), {}, deps()))).toBe(
      "401:invalid_token"
    );
  });

  it("refuses a malformed Authorization header", async () => {
    expect(
      await codeOf(
        requireApiUser(request({ authorization: "Token abc" }), {}, deps())
      )
    ).toBe("401:invalid_token");
  });

  it("refuses an ERP API key — it cannot attribute work to an operator", async () => {
    expect(
      await codeOf(
        requireApiUser(
          request({ authorization: "Bearer crbn_abc123" }),
          {},
          deps()
        )
      )
    ).toBe("401:invalid_token");
  });

  it("refuses a token Supabase does not recognise", async () => {
    expect(
      await codeOf(
        requireApiUser(
          request(authed),
          {},
          deps({ getUser: vi.fn().mockResolvedValue(null) as never })
        )
      )
    ).toBe("401:token_expired");
  });
});

describe("requireApiUser — company and permissions", () => {
  it("refuses a request with no company header", async () => {
    expect(
      await codeOf(
        requireApiUser(
          request({ authorization: authed.authorization }),
          {},
          deps()
        )
      )
    ).toBe("400:company_required");
  });

  it("refuses a portal account", async () => {
    expect(
      await codeOf(
        requireApiUser(
          request(authed),
          {},
          deps({
            getClaims: vi
              .fn()
              .mockResolvedValue({ role: "customer", permissions: {} })
          })
        )
      )
    ).toBe("403:forbidden");
  });

  it("refuses a permission the user holds only in another company", async () => {
    expect(
      await codeOf(
        requireApiUser(request(authed), { create: "quality" }, deps())
      )
    ).toBe("403:forbidden");
  });

  it("admits a permission scoped to this company", async () => {
    const user = await requireApiUser(
      request(authed),
      { view: "production" },
      deps()
    );
    expect(user.companyId).toBe(COMPANY);
    expect(user.userId).toBe(USER);
    expect(user.sessionUserId).toBe(USER);
    expect(user.consoleMode).toBe(false);
  });

  it("requires every action of a multi-action request", async () => {
    expect(
      await codeOf(
        requireApiUser(
          request(authed),
          { view: "production", delete: "production" },
          deps()
        )
      )
    ).toBe("403:forbidden");
  });
});

describe("requireApiUser — two-factor", () => {
  it("refuses an aal1 token when the user enrolled a factor", async () => {
    expect(
      await codeOf(
        requireApiUser(
          request(authed),
          {},
          deps({ hasTotp: vi.fn().mockResolvedValue(true) as never })
        )
      )
    ).toBe("401:mfa_required");
  });

  it("admits an aal2 token for the same user", async () => {
    const user = await requireApiUser(
      request({
        authorization: `Bearer ${token({ aal: "aal2" })}`,
        "x-carbon-company": COMPANY
      }),
      {},
      deps({ hasTotp: vi.fn().mockResolvedValue(true) as never })
    );
    expect(user.sessionUserId).toBe(USER);
  });
});

describe("requireApiUser — shared tablet", () => {
  const operator: ApiOperator = {
    userId: OPERATOR,
    companyId: COMPANY,
    sessionUserId: USER,
    pinnedAt: Date.now()
  };

  it("refuses an operator header when the endpoint accepts none", async () => {
    expect(
      await codeOf(
        requireApiUser(
          request({ ...authed, "x-carbon-operator": "tok" }),
          {},
          deps()
        )
      )
    ).toBe("400:validation_failed");
  });

  it("attributes the work to the pinned operator", async () => {
    const user = await requireApiUser(
      request({ ...authed, "x-carbon-operator": "tok" }),
      {},
      deps({
        operator: {
          verify: vi.fn().mockResolvedValue(operator),
          revalidate: vi.fn().mockResolvedValue(true)
        }
      })
    );
    expect(user.userId).toBe(OPERATOR);
    expect(user.sessionUserId).toBe(USER);
    expect(user.consoleMode).toBe(true);
  });

  it("refuses an operator token bound to another terminal", async () => {
    expect(
      await codeOf(
        requireApiUser(
          request({ ...authed, "x-carbon-operator": "tok" }),
          {},
          deps({
            operator: {
              verify: vi
                .fn()
                .mockResolvedValue({ ...operator, sessionUserId: "someone" }),
              revalidate: vi.fn().mockResolvedValue(true)
            }
          })
        )
      )
    ).toBe("401:operator_expired");
  });

  it("refuses an operator token bound to another company", async () => {
    expect(
      await codeOf(
        requireApiUser(
          request({ ...authed, "x-carbon-operator": "tok" }),
          {},
          deps({
            operator: {
              verify: vi
                .fn()
                .mockResolvedValue({ ...operator, companyId: "other" }),
              revalidate: vi.fn().mockResolvedValue(true)
            }
          })
        )
      )
    ).toBe("401:operator_expired");
  });

  it("refuses an operator whose pin-in no longer re-validates", async () => {
    expect(
      await codeOf(
        requireApiUser(
          request({ ...authed, "x-carbon-operator": "tok" }),
          {},
          deps({
            operator: {
              verify: vi.fn().mockResolvedValue(operator),
              revalidate: vi.fn().mockResolvedValue(false)
            }
          })
        )
      )
    ).toBe("401:operator_expired");
  });
});

describe("requireApiUser — rate limit", () => {
  it("refuses when the per-user limit is spent", async () => {
    expect(
      await codeOf(
        requireApiUser(
          request(authed),
          {},
          deps({ rateLimit: vi.fn().mockResolvedValue(false) })
        )
      )
    ).toBe("429:rate_limited");
  });

  it("falls back to the module limiter when no dep is injected", async () => {
    limitMock.mockResolvedValue({ success: false });
    // No `rateLimit` dep: the module's own Ratelimit must be what refuses.
    const withoutInjectedLimiter = { ...deps(), rateLimit: undefined };
    expect(
      await codeOf(requireApiUser(request(authed), {}, withoutInjectedLimiter))
    ).toBe("429:rate_limited");
    expect(limitMock).toHaveBeenCalledWith(USER);
  });
});

describe("apiErrorResponse", () => {
  it("serialises the error shape and always sets carbon-api", async () => {
    const res = apiErrorResponse(
      new ApiError(409, "blocked", "Storage rule refused this", undefined, {
        ruleNames: ["No mixed lots"]
      })
    );
    expect(res.status).toBe(409);
    expect(res.headers.get("carbon-api")).toBe("1");
    expect(await res.json()).toEqual({
      error: {
        code: "blocked",
        message: "Storage rule refused this",
        details: { ruleNames: ["No mixed lots"] }
      }
    });
  });

  it("carries field errors when validation failed", async () => {
    const res = apiErrorResponse(
      new ApiError(400, "validation_failed", "Check the form", {
        quantity: ["Must be positive"]
      })
    );
    expect(await res.json()).toEqual({
      error: {
        code: "validation_failed",
        message: "Check the form",
        fields: { quantity: ["Must be positive"] }
      }
    });
  });
});
