import { describe, expect, it, vi } from "vitest";

// Isolation mocks — provisioning's cache/redis/logger dependencies are stubbed
// so the pure decision logic can be tested without dragging in the full module
// graph. The Kysely db is a caller-supplied parameter and is not needed here.
vi.mock("@carbon/auth", () => ({
  getPermissionCacheKey: vi.fn((id: string) => `permissions:${id}`)
}));

vi.mock("@carbon/kv", () => ({
  redis: { del: vi.fn().mockResolvedValue(null) }
}));

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

vi.mock("@carbon/utils", () => ({
  datetime: { timestamp: vi.fn(() => "2026-01-01T00:00:00.000Z") }
}));

const {
  buildArchivedEmail,
  deleteJitSsoUser,
  mergeInvitePermissions,
  uncoveredSsoDomainError
} = await import("./provisioning.server");

describe("buildArchivedEmail", () => {
  it("is deterministic for the same inputs", () => {
    expect(buildArchivedEmail("user_1", "jane@acme.com")).toEqual(
      buildArchivedEmail("user_1", "jane@acme.com")
    );
  });

  it("contains the old user id and preserves the full original email as a suffix", () => {
    const archived = buildArchivedEmail("user_1", "jane@acme.com");
    expect(archived).toContain("user_1");
    expect(archived.endsWith("jane@acme.com")).toBe(true);
  });

  it("produces distinct archived emails for distinct old user ids", () => {
    expect(buildArchivedEmail("user_1", "jane@acme.com")).not.toEqual(
      buildArchivedEmail("user_2", "jane@acme.com")
    );
  });

  it("never equals the original email (frees the unique email index)", () => {
    expect(buildArchivedEmail("user_1", "jane@acme.com")).not.toEqual(
      "jane@acme.com"
    );
  });
});

describe("mergeInvitePermissions", () => {
  it("takes new keys as-is and concatenates existing keys (setUserPermissions semantics)", () => {
    const merged = mergeInvitePermissions(
      { sales_view: ["c1"] },
      { sales_view: ["c2"], parts_view: ["c2"] }
    );
    expect(merged).toEqual({
      sales_view: ["c1", "c2"],
      parts_view: ["c2"]
    });
  });

  it("does not mutate the current permission set", () => {
    const current = { sales_view: ["c1"] };
    mergeInvitePermissions(current, { sales_view: ["c2"] });
    expect(current).toEqual({ sales_view: ["c1"] });
  });

  it("concatenates duplicates when the same grant is merged twice (matches setUserPermissions, which does not dedupe)", () => {
    const once = mergeInvitePermissions({}, { sales_view: ["c2"] });
    const twice = mergeInvitePermissions(once, { sales_view: ["c2"] });
    expect(twice).toEqual({ sales_view: ["c2", "c2"] });
  });

  it('keeps "0" wildcard entries untouched when merging', () => {
    const merged = mergeInvitePermissions(
      { sales_view: ["0"], parts_update: ["0"] },
      { sales_view: ["c2"] }
    );
    expect(merged).toEqual({
      sales_view: ["0", "c2"],
      parts_update: ["0"]
    });
  });
});

// In-memory model of the state the on_auth_user_created trigger leaves behind
// for a JIT SSO user: an auth user plus its auto-created public."user" and
// userPermission rows (no FK cascade between the schemas — that gap is the bug).
function makeJitUserState(userId: string, options?: { memberOf?: string[] }) {
  return {
    authUsers: new Set([userId]),
    publicUsers: new Set([userId]),
    userPermissions: new Set([userId]),
    memberships: new Set(options?.memberOf ?? [])
  };
}

function makeFakeDb(state: ReturnType<typeof makeJitUserState>) {
  const deleteFrom = (table: string) => {
    let targetId: string | undefined;
    const chain = {
      where: (_column: string, _op: string, value: string) => {
        targetId = value;
        return chain;
      },
      execute: async () => {
        if (targetId === undefined) return [];
        if (table === "userPermission") state.userPermissions.delete(targetId);
        if (table === "user") state.publicUsers.delete(targetId);
        return [];
      }
    };
    return chain;
  };

  return {
    selectFrom: (_table: string) => ({
      select: (_column: string) => ({
        where: (_c: string, _op: string, value: string) => ({
          limit: (_n: number) => ({
            executeTakeFirst: async () =>
              state.memberships.has(value) ? { companyId: "c1" } : undefined
          })
        })
      })
    }),
    transaction: () => ({
      execute: async (
        cb: (trx: { deleteFrom: typeof deleteFrom }) => unknown
      ) => cb({ deleteFrom })
    })
  } as never;
}

function makeFakeServiceRole(state: ReturnType<typeof makeJitUserState>) {
  return {
    auth: {
      admin: {
        deleteUser: vi.fn(async (id: string) => {
          state.authUsers.delete(id);
          return { data: {}, error: null };
        })
      }
    }
  } as never;
}

describe("deleteJitSsoUser", () => {
  // The invite paths refuse when a public."user" row exists whose auth account
  // is gone (authIdentityExists) — the orphan state this helper must prevent.
  const isUninvitableOrphan = (
    state: ReturnType<typeof makeJitUserState>,
    userId: string
  ) => state.publicUsers.has(userId) && !state.authUsers.has(userId);

  it("removes the whole throwaway user after a no-invite rejection, so the email stays invitable", async () => {
    const state = makeJitUserState("jit_user");
    const result = await deleteJitSsoUser(
      makeFakeServiceRole(state),
      makeFakeDb(state),
      "jit_user"
    );

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ deleted: true });
    expect(state.authUsers.has("jit_user")).toBe(false);
    expect(state.publicUsers.has("jit_user")).toBe(false);
    expect(state.userPermissions.has("jit_user")).toBe(false);
    // The regression: deleting only the auth half left this true, tripping
    // "This user's auth account no longer exists" on the next invite.
    expect(isUninvitableOrphan(state, "jit_user")).toBe(false);
  });

  it("refuses to delete a user with a company membership (never a linked/real account)", async () => {
    const state = makeJitUserState("real_user", { memberOf: ["real_user"] });
    const serviceRole = makeFakeServiceRole(state);
    const result = await deleteJitSsoUser(
      serviceRole,
      makeFakeDb(state),
      "real_user"
    );

    expect(result.data).toEqual({ deleted: false });
    expect(result.error).toBeNull();
    expect(state.authUsers.has("real_user")).toBe(true);
    expect(state.publicUsers.has("real_user")).toBe(true);
    expect(state.userPermissions.has("real_user")).toBe(true);
    expect(
      (serviceRole as { auth: { admin: { deleteUser: unknown } } }).auth.admin
        .deleteUser
    ).not.toHaveBeenCalled();
  });

  it("returns the auth deletion failure without recreating the orphan state", async () => {
    const state = makeJitUserState("jit_user");
    const serviceRole = {
      auth: {
        admin: {
          deleteUser: vi
            .fn()
            .mockResolvedValue({ data: {}, error: { message: "gotrue down" } })
        }
      }
    } as never;

    const result = await deleteJitSsoUser(
      serviceRole,
      makeFakeDb(state),
      "jit_user"
    );

    expect(result.data).toBeNull();
    expect(result.error).toContain("gotrue down");
    // Public rows go first: a failed auth delete leaves an auth-only remnant
    // (self-healing on the next SSO attempt), never the un-invitable orphan.
    expect(state.publicUsers.has("jit_user")).toBe(false);
    expect(state.userPermissions.has("jit_user")).toBe(false);
    expect(isUninvitableOrphan(state, "jit_user")).toBe(false);
  });
});

describe("uncoveredSsoDomainError", () => {
  const domains = ["acme.com", "acme.org"];

  it("allows an email on a covered domain", () => {
    expect(uncoveredSsoDomainError(domains, "jane@acme.com")).toBeNull();
    expect(uncoveredSsoDomainError(domains, "jane@acme.org")).toBeNull();
  });

  it("is case-insensitive on the email side (stored domains are already lowercase)", () => {
    expect(uncoveredSsoDomainError(domains, "Jane@ACME.com")).toBeNull();
  });

  it("refuses an email on an uncovered domain, naming the covered domains", () => {
    const message = uncoveredSsoDomainError(domains, "jane@gmail.com");
    expect(message).toContain("acme.com, acme.org");
  });

  it("does not treat a subdomain as covered (matches GoTrue's exact-domain routing)", () => {
    expect(
      uncoveredSsoDomainError(domains, "jane@sub.acme.com")
    ).not.toBeNull();
  });

  it("does not treat a suffix-alike domain as covered", () => {
    expect(uncoveredSsoDomainError(domains, "jane@notacme.com")).not.toBeNull();
  });

  it("refuses a malformed email with no domain part", () => {
    expect(uncoveredSsoDomainError(domains, "jane")).not.toBeNull();
    expect(uncoveredSsoDomainError(domains, "jane@")).not.toBeNull();
  });
});
