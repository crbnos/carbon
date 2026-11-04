// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

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
  isThrowawaySsoAccount,
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
  it("takes new keys as-is and unions existing keys", () => {
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

  it("does not repeat a company id when the same grant is merged twice", () => {
    const once = mergeInvitePermissions({}, { sales_view: ["c2"] });
    const twice = mergeInvitePermissions(once, { sales_view: ["c2"] });
    expect(twice).toEqual({ sales_view: ["c2"] });
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
function makeJitUserState(
  userId: string,
  options?: { memberOf?: string[]; providers?: string[]; createdAt?: string }
) {
  return {
    authUsers: new Set([userId]),
    publicUsers: new Set([userId]),
    userPermissions: new Set([userId]),
    memberships: new Set(options?.memberOf ?? []),
    // What GoTrue returns for the account: a JIT SSO user has only its sso:
    // identity and was created by the sign-in that is being refused.
    providers: options?.providers ?? ["sso:p1"],
    createdAt: options?.createdAt ?? new Date().toISOString()
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
        getUserById: async (id: string) => ({
          data: {
            user: state.authUsers.has(id)
              ? {
                  id,
                  created_at: state.createdAt,
                  identities: state.providers.map((provider) => ({ provider }))
                }
              : null
          },
          error: null
        }),
        deleteUser: vi.fn(async (id: string) => {
          state.authUsers.delete(id);
          return { data: {}, error: null };
        })
      }
    }
  } as never;
}

// An access token as GoTrue mints it for a SAML session: `amr` records when the
// session authenticated, in Unix seconds. Unsigned — only its claims are read.
function samlToken(userId: string, signedInAtMs: number, method = "sso/saml") {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({
      sub: userId,
      amr: [{ method, timestamp: Math.floor(signedInAtMs / 1000) }]
    }),
    "signature"
  ].join(".");
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
      { userId: "jit_user", accessToken: samlToken("jit_user", Date.now()) }
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
    const result = await deleteJitSsoUser(serviceRole, makeFakeDb(state), {
      userId: "real_user",
      accessToken: samlToken("real_user", Date.now())
    });

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

  // With sign-ups disabled GoTrue cannot create a user, so an account with no
  // membership reaching a refusal is usually a real one: invited then revoked,
  // removed from every company, or a fresh instance's seed admin. And a
  // refusal that cannot show its own sign-in created the account keeps it.
  it.each([
    [
      "has an email identity (invited, seeded or admin)",
      { providers: ["email", "sso:p1"] },
      () => samlToken("real_user", Date.now())
    ],
    [
      "is SSO-only but older than this sign-in",
      { createdAt: "2026-01-01T00:00:00Z" },
      () => samlToken("real_user", Date.now())
    ],
    [
      "is reached by a session that did not sign in through SAML",
      {},
      () => samlToken("real_user", Date.now(), "otp")
    ],
    [
      "is reached with another user's token",
      {},
      () => samlToken("other_user", Date.now())
    ],
    ["is reached with an unreadable token", {}, () => "not-a-jwt"]
  ])(
    "keeps an account with no membership that %s",
    async (_case, options, accessToken) => {
      const state = makeJitUserState("real_user", options);
      const serviceRole = makeFakeServiceRole(state);
      const result = await deleteJitSsoUser(serviceRole, makeFakeDb(state), {
        userId: "real_user",
        accessToken: accessToken()
      });

      expect(result).toEqual({ data: { deleted: false }, error: null });
      expect(state.authUsers.has("real_user")).toBe(true);
      expect(state.publicUsers.has("real_user")).toBe(true);
      expect(state.userPermissions.has("real_user")).toBe(true);
    }
  );

  it("returns the auth deletion failure without recreating the orphan state", async () => {
    const state = makeJitUserState("jit_user");
    const serviceRole = {
      auth: {
        admin: {
          getUserById: async (id: string) => ({
            data: {
              user: {
                id,
                created_at: state.createdAt,
                identities: [{ provider: "sso:p1" }]
              }
            },
            error: null
          }),
          deleteUser: vi
            .fn()
            .mockResolvedValue({ data: {}, error: { message: "gotrue down" } })
        }
      }
    } as never;

    const result = await deleteJitSsoUser(serviceRole, makeFakeDb(state), {
      userId: "jit_user",
      accessToken: samlToken("jit_user", Date.now())
    });

    expect(result.data).toBeNull();
    expect(result.error).toContain("gotrue down");
    // Public rows go first: a failed auth delete leaves an auth-only remnant
    // (self-healing on the next SSO attempt), never the un-invitable orphan.
    expect(state.publicUsers.has("jit_user")).toBe(false);
    expect(state.userPermissions.has("jit_user")).toBe(false);
    expect(isUninvitableOrphan(state, "jit_user")).toBe(false);
  });
});

describe("isThrowawaySsoAccount", () => {
  const signedInAtMs = Date.parse("2026-10-29T12:00:00Z");
  const nowMs = Date.parse("2026-10-29T12:00:05Z");
  const account = (providers: string[], createdAt: string) => ({
    created_at: createdAt,
    identities: providers.map((provider) => ({ provider }))
  });

  it.each([
    ["moments before this sign-in", "2026-10-29T11:59:50Z"],
    // amr times are whole seconds, so the session can read as up to a second
    // older than the account created in the same request.
    ["in the same second as this sign-in", "2026-10-29T12:00:00.400Z"]
  ])(
    "is true for an SSO-only account GoTrue created %s",
    (_case, createdAt) => {
      expect(
        isThrowawaySsoAccount(account(["sso:p1"], createdAt), {
          signedInAtMs,
          nowMs
        })
      ).toBe(true);
    }
  );

  it.each([
    ["it has an email identity", ["email", "sso:p1"], "2026-10-29T11:59:50Z"],
    ["it existed well before this sign-in", ["sso:p1"], "2026-10-29T11:50:00Z"],
    ["it was created after this sign-in", ["sso:p1"], "2026-10-29T12:00:03Z"],
    ["its creation time cannot be read", ["sso:p1"], "not a date"],
    ["it has no identity at all", [], "2026-10-29T11:59:50Z"]
  ])("is false when %s", (_case, providers, createdAt) => {
    expect(
      isThrowawaySsoAccount(account(providers, createdAt), {
        signedInAtMs,
        nowMs
      })
    ).toBe(false);
  });

  it("is false when the sign-in time is unknown", () => {
    expect(
      isThrowawaySsoAccount(account(["sso:p1"], "2026-10-29T11:59:50Z"), {
        signedInAtMs: null,
        nowMs
      })
    ).toBe(false);
  });

  // An old session that happened to create the account, replayed now, is not
  // the sign-in being refused.
  it("is false when the session signed in long before now", () => {
    expect(
      isThrowawaySsoAccount(account(["sso:p1"], "2026-10-29T11:59:50Z"), {
        signedInAtMs,
        nowMs: Date.parse("2026-10-29T13:00:00Z")
      })
    ).toBe(false);
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

  // A connection whose domains are all still pending routes no sign-in to SSO,
  // so a magic-link invite bypasses nothing.
  it("allows any email while the connection has no verified domain", () => {
    expect(uncoveredSsoDomainError([], "jane@acme.com")).toBeNull();
  });
});
