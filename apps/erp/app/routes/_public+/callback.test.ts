// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  acceptInvite: vi.fn(),
  employeeCompanies: [] as { companyId: string; companyGroupId: string }[],
  pendingInvite: null as { code: string } | null,
  sessions: [] as { companyId?: string; companyGroupId?: string }[]
}));

vi.mock("@carbon/auth", () => ({
  assertIsPost: () => undefined,
  callbackValidator: {},
  carbonClient: {},
  error: (_e: unknown, message: string) => ({ success: false, message }),
  getCarbon: vi.fn()
}));
vi.mock("@carbon/auth/auth.server", () => ({
  refreshAccessToken: async (_t: string, companyId?: string) => ({
    userId: "usr_1",
    email: "invitee@example.com",
    accessToken: "at",
    refreshToken: "rt",
    companyId,
    companyGroupId: ""
  })
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const k of ["select", "ilike", "is", "eq", "order", "limit"]) {
        chain[k] = () => chain;
      }
      chain.maybeSingle = async () => ({
        data:
          table === "invite" ? m.pendingInvite : { companyGroupId: "grp_1" },
        error: null
      });
      return chain;
    }
  })
}));
vi.mock("@carbon/auth/company.server", () => ({
  getCompanyId: () => null,
  setCompanyId: (id?: string) => `companyId=${id}`
}));
vi.mock("@carbon/auth/mfa.server", () => ({
  userHasVerifiedTotpFactor: async () => false
}));
vi.mock("@carbon/auth/self-signup.server", () => ({
  isPlatformSignupDisabled: async () => false,
  isSelfSignupBlockedForEmail: () => false,
  PLATFORM_SIGNUP_DISABLED_MESSAGE: "",
  SELF_SIGNUP_BLOCKED_MESSAGE: ""
}));
vi.mock("@carbon/auth/session.server", () => ({
  destroyAuthSession: vi.fn(),
  flash: vi.fn(),
  getAuthSession: vi.fn(),
  setAuthSession: async (
    _r: Request,
    { authSession }: { authSession: { companyId?: string } }
  ) => {
    m.sessions.push({ ...authSession });
    return "session=1";
  },
  setPendingMfaSession: vi.fn()
}));
vi.mock("@carbon/auth/users.server", () => ({
  getUserByEmail: async () => ({ data: { id: "usr_1" } })
}));
vi.mock("@carbon/ee/sso.server", () => ({
  deleteJitSsoUser: vi.fn(),
  getSsoConnectionByProviderId: vi.fn(),
  getSsoProviderIdFromSession: vi.fn(),
  isSsoEnabled: () => false,
  isSsoRequiredForEmail: async () => false,
  linkSsoIdentityToUser: vi.fn(),
  migrateUserToSso: vi.fn()
}));
vi.mock("@carbon/form", () => ({
  validator: () => ({
    validate: async () => ({
      data: { refreshToken: "rt0", userId: "usr_1", redirectTo: undefined }
    })
  })
}));
vi.mock("@carbon/kv", () => ({
  AccountLockout: class {
    reset = async () => undefined;
  },
  redis: {},
  SIGN_IN_CODE_LOCKOUT_PREFIX: "code"
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));
vi.mock("@carbon/react", () => ({}));
vi.mock("@carbon/utils", () => ({
  redirect: (location: string, init?: { headers?: [string, string][] }) => ({
    location,
    headers: init?.headers ?? []
  })
}));
vi.mock("@lingui/react/macro", () => ({ Trans: () => null }));
vi.mock("react-icons/lu", () => ({}));
vi.mock("~/modules/settings/settings.service", () => ({
  getCompanies: async () => ({ data: [] }),
  getEmployeeCompanies: async () => ({ data: m.employeeCompanies })
}));
vi.mock("~/modules/users/users.service", () => ({
  acceptInvite: m.acceptInvite
}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => ({})
}));
vi.mock("~/utils/path", () => ({
  path: { to: { root: "/", authenticatedRoot: "/x", mfa: "/mfa" } }
}));

const { action } = await import("./callback");

const signIn = async () =>
  (await action({
    request: new Request("http://localhost/callback", {
      method: "POST",
      body: new FormData()
    })
  } as unknown as ActionFunctionArgs)) as unknown as {
    location: string;
    headers: [string, string][];
  };

describe("callback for an invitee who signed in from the sign-in page", () => {
  beforeEach(() => {
    m.acceptInvite.mockReset().mockResolvedValue({
      data: { id: "inv_1", companyId: "co_1", acceptedAt: "now" },
      error: null
    });
    m.employeeCompanies = [];
    m.pendingInvite = { code: "code_1" };
    m.sessions.length = 0;
  });

  it("accepts their open invite and signs them into its company", async () => {
    const res = await signIn();

    expect(m.acceptInvite).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "code_1",
      "invitee@example.com",
      expect.any(Request)
    );
    expect(m.sessions).toEqual([
      expect.objectContaining({ companyId: "co_1", companyGroupId: "grp_1" })
    ]);
    expect(res.location).toBe("/x");
    expect(res.headers).toContainEqual(["Set-Cookie", "companyId=co_1"]);
  });

  it("leaves the invite alone for someone already in a company", async () => {
    m.employeeCompanies = [{ companyId: "co_0", companyGroupId: "grp_0" }];

    await signIn();

    expect(m.acceptInvite).not.toHaveBeenCalled();
    expect(m.sessions[0]?.companyId).toBe("co_0");
  });

  it("still signs them in when the invite cannot be accepted", async () => {
    m.acceptInvite.mockRejectedValue(new Error("Invite code does not match"));

    const res = await signIn();

    expect(m.sessions).toHaveLength(1);
    expect(res.location).toBe("/x");
  });
});
