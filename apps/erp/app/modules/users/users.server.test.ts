// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createServiceContext } from "@carbon/api/service-fn.server";
import type { KyselyDatabase } from "@carbon/database/client";
import {
  type CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult
} from "kysely";
import { describe, expect, it, vi } from "vitest";

// The job runner is Inngest over the network: keep what would be sent.
const queued = vi.hoisted(() => [] as { name: string; events: unknown[] }[]);
vi.mock("@carbon/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/jobs")>()),
  batchTrigger: vi.fn(async (name: string, events: unknown[]) => {
    queued.push({ name, events });
  })
}));
// The plan lookup: this company may author roles.
vi.mock("@carbon/ee/plan.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/ee/plan.server")>()),
  companyHasFeature: vi.fn(async () => true)
}));
// Redis is over the network: deactivating clears the cached claims there.
vi.mock("@carbon/kv", () => ({ redis: { del: vi.fn(async () => 1) } }));

import {
  bulkUpdatePermissions,
  certifyItarEntity,
  createGroup,
  deactivateUsers,
  getEmployeePermissions,
  inviteCustomerContact,
  inviteEmployee,
  inviteSupplierContact,
  resendInvites,
  resetConsoleOperatorPin,
  revokeInvites,
  updateGroup
} from "./users.server";
import {
  canReAddDeactivatedEmployee,
  makePermissionsFromEmployeeType,
  refuseUninvitableContact
} from "./users.service";

const COMPANY = "cmp_1";

describe("canReAddDeactivatedEmployee", () => {
  const grant = (users: string[], people: string[]) => ({
    users: { view: [], create: [COMPANY], update: users, delete: [] },
    people: { view: [], create: people, update: [], delete: [] }
  });

  it("allows an inviter with users update and people create", () => {
    expect(
      canReAddDeactivatedEmployee(grant([COMPANY], [COMPANY]), COMPANY)
    ).toBe(true);
  });

  it.each([
    ["users create alone", grant([], [])],
    ["no people create", grant([COMPANY], [])],
    ["no users update", grant([], [COMPANY])],
    ["both, for another company", grant(["cmp_2"], ["cmp_2"])],
    ["unreadable claims", null]
  ])("refuses an inviter with %s", (_label, permissions) => {
    expect(canReAddDeactivatedEmployee(permissions, COMPANY)).toBe(false);
  });
});

describe("makePermissionsFromEmployeeType", () => {
  it("keys each module's grants by module_action", () => {
    expect(
      makePermissionsFromEmployeeType({
        data: [
          {
            module: "Sales",
            view: [COMPANY],
            create: [COMPANY],
            update: [],
            delete: []
          }
        ]
      })
    ).toEqual({
      sales_view: [COMPANY],
      sales_create: [COMPANY],
      sales_update: [],
      sales_delete: []
    });
  });
});

const unreachable = () => {
  throw new Error("must not be reached");
};

/** A user in COMPANY holding `permissions`; the caller client returns `user`. */
function userContext(
  permissions: Record<string, Record<string, string[]>>,
  user: Record<string, unknown> | null = null
) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    single: async () =>
      user ? { data: user, error: null } : { data: null, error: {} }
  };
  return createServiceContext({
    actor: { type: "user", userId: "usr_admin", permissions },
    company: { id: COMPANY, groupId: "grp_1" },
    caller: { from: () => chain } as never,
    system: unreachable as never,
    pg: unreachable as never,
    kv: unreachable as never
  });
}

describe("operation guards", () => {
  // A PIN signs in as that person anywhere on the floor, so anyone but a
  // console operator needs settings update as well.
  it("refuses resetting a non-operator's PIN with users update alone", async () => {
    const result = await resetConsoleOperatorPin(
      userContext(
        { users: { update: [COMPANY] } },
        { id: "usr_1", isConsoleOperator: false }
      ),
      { operatorId: "usr_1" }
    );
    expect(result.error?.category).toBe("forbidden");
  });

  it("refuses deactivating the caller's own account", async () => {
    const result = await deactivateUsers(
      userContext({ users: { delete: [COMPANY] } }),
      { userIds: ["usr_1", "usr_admin"] }
    );
    expect(result.error?.category).toBe("rule");
  });

  // An API key authenticates as the key, not a person: there is no signer.
  it("refuses an API key signing the ITAR Rider", async () => {
    const ctx = createServiceContext({
      actor: {
        type: "apiKey",
        createdBy: "usr_admin",
        scopes: {
          users: { view: [], create: [], update: [COMPANY], delete: [] }
        }
      },
      company: { id: COMPANY, groupId: "grp_1" },
      caller: {} as never,
      system: unreachable as never,
      pg: unreachable as never,
      kv: unreachable as never
    });
    const result = await certifyItarEntity(ctx, {
      authorityToBind: true,
      acceptRider: true,
      fullLegalName: "Pat Doe",
      title: "CEO",
      complianceContact: "export@example.com"
    });
    expect(result.error?.category).toBe("forbidden");
  });
});

type Row = Record<string, unknown>;

/**
 * The service-role client over in-memory tables: `select` / `update` /
 * `delete` with the `eq`, `in` and `is` filters the operations use, and the
 * RPCs they call (answering `rpcResults[name]`, else 1).
 */
function memoryClient(
  tables: Record<string, Row[]>,
  rpcResults: Record<string, unknown> = {}
) {
  const rpcs: { name: string; args: Row }[] = [];
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let patch: Row | null = null;
    let remove = false;
    const run = () => {
      const rows = (tables[table] ?? []).filter((row) =>
        filters.every((keep) => keep(row))
      );
      if (patch) for (const row of rows) Object.assign(row, patch);
      if (remove) {
        tables[table] = (tables[table] ?? []).filter(
          (row) => !rows.includes(row)
        );
      }
      return { data: rows.map((row) => ({ ...row })), error: null };
    };
    const query = {
      select: () => query,
      update: (values: Row) => {
        patch = values;
        return query;
      },
      delete: () => {
        remove = true;
        return query;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return query;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return query;
      },
      is: (column: string, value: null) => {
        filters.push((row) => (row[column] ?? null) === value);
        return query;
      },
      match: (values: Row) => {
        for (const [column, value] of Object.entries(values)) {
          query.eq(column, value);
        }
        return query;
      },
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      single: async () => {
        const { data } = run();
        return data.length === 1
          ? { data: data[0], error: null }
          : { data: null, error: { code: "PGRST116", message: "Not one row" } };
      },
      then: (resolve: (result: ReturnType<typeof run>) => unknown) =>
        resolve(run())
    };
    return query;
  };
  const client = {
    from,
    rpc: async (name: string, args: Row) => {
      rpcs.push({ name, args });
      return { data: name in rpcResults ? rpcResults[name] : 1, error: null };
    }
  };
  return { client, rpcs };
}

const ORIGIN = { ip: "203.0.113.9", city: "Oslo", userAgent: "agent/1.0" };

/** A user in COMPANY whose request came from ORIGIN, over `tables`. */
function requestContext(
  permissions: Record<string, Record<string, string[]>>,
  tables: Record<string, Row[]> = {},
  rpcResults: Record<string, unknown> = {},
  pg: Kysely<KyselyDatabase> | null = null
) {
  const system = memoryClient(tables, rpcResults);
  const ctx = createServiceContext({
    actor: { type: "user", userId: "usr_admin", permissions },
    company: { id: COMPANY, groupId: "grp_1" },
    origin: ORIGIN,
    caller: {} as never,
    system: () => system.client as never,
    pg: pg ? () => pg : (unreachable as never),
    kv: unreachable as never
  });
  return { ctx, rpcs: system.rpcs };
}

/**
 * Kysely over a wire that records each statement and answers it with the
 * next scripted rows.
 */
function recordingDatabase(results: unknown[][]) {
  const sent: CompiledQuery[] = [];
  class RecordingDriver extends DummyDriver {
    override async acquireConnection(): Promise<DatabaseConnection> {
      return {
        executeQuery: async <R>(
          query: CompiledQuery
        ): Promise<QueryResult<R>> => {
          sent.push(query);
          return { rows: (results.shift() ?? []) as R[] };
        },
        // biome-ignore lint/correctness/useYield: never streamed
        streamQuery: async function* () {
          throw new Error("not streamed");
        }
      };
    }
  }
  const db = new Kysely<KyselyDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new RecordingDriver(),
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });
  const statements = () =>
    sent.map((query) => ({ sql: query.sql, parameters: query.parameters }));
  return { db, statements };
}

/** People invited to COMPANY as employees, not yet accepted. */
const invitedEmployees = (
  ids: string[],
  extra: Record<string, Row[]> = {}
): Record<string, Row[]> => ({
  user: ids.map((id) => ({ id, email: `${id}@example.com` })),
  invite: ids.map((id) => ({
    id: `inv_${id}`,
    email: `${id}@example.com`,
    companyId: COMPANY,
    role: "employee"
  })),
  employee: ids.map((id) => ({ id, companyId: COMPANY, active: false })),
  ...extra
});

// A caller once sent the IP and user agent as arguments, so an API key could
// write any address into the invite email and the audit log.
describe("the request's origin", () => {
  const forged = { ip: "6.6.6.6", city: "Nowhere", userAgent: "forged" };

  it("puts the request's IP and city on queued invites", async () => {
    queued.length = 0;
    const { ctx } = requestContext(
      { users: { create: [COMPANY] } },
      invitedEmployees(["usr_1", "usr_2"])
    );
    const result = await resendInvites(ctx, {
      userIds: ["usr_1", "usr_2"],
      ...forged
    } as never);
    expect(result).toEqual({ data: { queued: true }, error: null });
    expect(queued).toEqual([
      {
        name: "user-admin",
        events: ["usr_1", "usr_2"].map((id) => ({
          payload: {
            id,
            type: "resend",
            companyId: COMPANY,
            location: "Oslo",
            ip: "203.0.113.9"
          }
        }))
      }
    ]);
  });

  it("puts the request's IP on a bulk permission change", async () => {
    queued.length = 0;
    const { ctx } = requestContext(
      { users: { update: [COMPANY] } },
      { employee: [{ id: "usr_1", companyId: COMPANY }] }
    );
    const permissions = {
      sales: { view: true, create: false, update: false, delete: false }
    };
    await bulkUpdatePermissions(ctx, {
      editType: "add",
      userIds: ["usr_1"],
      permissions,
      ...forged
    } as never);
    expect(queued).toEqual([
      {
        name: "update-permissions",
        events: [
          {
            payload: {
              id: "usr_1",
              permissions,
              addOnly: true,
              companyId: COMPANY,
              actorId: "usr_admin",
              ip: "203.0.113.9"
            }
          }
        ]
      }
    ]);
  });

  it("writes the request's IP and user agent into a revocation's audit record", async () => {
    queued.length = 0;
    const { ctx, rpcs } = requestContext(
      { users: { delete: [COMPANY] } },
      {
        user: [
          { id: "usr_1", email: "a@example.com" },
          { id: "usr_2", email: "b@example.com" }
        ],
        invite: [
          { id: "inv_1", email: "a@example.com", companyId: COMPANY },
          { id: "inv_2", email: "b@example.com", companyId: COMPANY }
        ]
      }
    );
    const result = await revokeInvites(ctx, {
      userIds: ["usr_1", "usr_2"],
      ...forged
    } as never);
    expect(result).toEqual({ data: { revoked: 2 }, error: null });
    const audit = rpcs.find((call) => call.name === "insert_audit_log_batch");
    expect(
      (audit?.args.p_entries as { metadata: unknown }[]).map(
        (entry) => entry.metadata
      )
    ).toEqual([
      { ipAddress: "203.0.113.9", userAgent: "agent/1.0" },
      { ipAddress: "203.0.113.9", userAgent: "agent/1.0" }
    ]);
    expect(queued[0]?.events).toEqual(
      ["usr_1", "usr_2"].map((id) => ({
        payload: {
          id,
          type: "deactivate",
          companyId: COMPANY,
          actorId: "usr_admin",
          ip: "203.0.113.9"
        }
      }))
    );
  });
});

// Revoking deactivates the user, and deactivating an account needs delete.
describe("revoking an invite", () => {
  const invited = (extra: Record<string, Row[]> = {}) => ({
    user: [{ id: "usr_1", email: "a@example.com" }],
    invite: [{ id: "inv_1", email: "a@example.com", companyId: COMPANY }],
    ...extra
  });
  const revoke = (tables: Record<string, Row[]>, userIds = ["usr_1"]) =>
    revokeInvites(
      requestContext({ users: { delete: [COMPANY] } }, tables).ctx,
      { userIds }
    );

  // The lists show Revoke Invite only with users delete.
  it("refuses a caller with users create alone", async () => {
    const result = await revokeInvites(
      requestContext({ users: { create: [COMPANY] } }, invited()).ctx,
      { userIds: ["usr_1"] }
    );
    expect(result.error?.category).toBe("forbidden");
  });

  // deactivateUser stamps the invite revoked itself, so the invite ids are
  // read before it, or the revocation (and its audit record) finds none.
  it("revokes one user's invite after deactivating them", async () => {
    queued.length = 0;
    const tables = invitedEmployees(["usr_1"]);
    const { ctx, rpcs } = requestContext(
      { users: { delete: [COMPANY] } },
      tables
    );
    const result = await revokeInvites(ctx, { userIds: ["usr_1"] });
    expect(result).toEqual({ data: { revoked: 1 }, error: null });
    expect(queued).toEqual([]);
    expect(tables.invite?.[0]?.revokedAt).toEqual(expect.any(String));
    const audit = rpcs.find((call) => call.name === "insert_audit_log_batch");
    expect(
      (audit?.args.p_entries as { entityId: unknown }[]).map(
        (entry) => entry.entityId
      )
    ).toEqual(["inv_usr_1"]);
  });

  it("refuses a user who has an account in the company", async () => {
    const result = await revoke(
      invited({ userToCompany: [{ userId: "usr_1", companyId: COMPANY }] })
    );
    expect(result.error?.category).toBe("rule");
  });

  it.each([
    ["accepted", { acceptedAt: "2026-11-01T00:00:00Z" }],
    ["already revoked", { revokedAt: "2026-11-01T00:00:00Z" }],
    ["in another company", { companyId: "cmp_2" }]
  ])("refuses a user whose invite is %s", async (_label, change) => {
    const result = await revoke({
      user: [{ id: "usr_1", email: "a@example.com" }],
      invite: [
        { id: "inv_1", email: "a@example.com", companyId: COMPANY, ...change }
      ]
    });
    expect(result.error?.category).toBe("rule");
  });

  it("refuses a user id that names no one", async () => {
    const result = await revoke(invited(), ["usr_1", "usr_9"]);
    expect(result.error?.category).toBe("notFound");
  });
});

const usersScopes = (actions: Partial<Record<string, string[]>>) => ({
  users: { view: [], create: [], update: [], delete: [], ...actions }
});

/** An API key of COMPANY holding `scopes`; nothing may be read or written. */
const keyContext = (scopes: Record<string, Record<string, string[]>>) =>
  createServiceContext({
    actor: { type: "apiKey", createdBy: "usr_admin", scopes },
    company: { id: COMPANY, groupId: "grp_1" },
    caller: unreachable as never,
    system: unreachable as never,
    pg: unreachable as never,
    kv: unreachable as never
  });

describe("API key scopes beyond the gate", () => {
  // A first-time invite inserts the employee under RLS, and a re-add checks
  // the key creator's claims: the key itself must hold both.
  it("refuses an invite from a key with users create alone", async () => {
    const result = await inviteEmployee(
      keyContext(usersScopes({ create: [COMPANY] })),
      {
        email: "new@example.com",
        firstName: "Pat",
        lastName: "Doe",
        employeeType: "et_1",
        locationId: "loc_1"
      }
    );
    expect(result.error?.category).toBe("forbidden");
  });

  // The route has only ever required view: a read-only key must not write.
  it("refuses a group change from a key with users view alone", async () => {
    const result = await updateGroup(
      keyContext(usersScopes({ view: [COMPANY] })),
      { id: "grp_x", name: "Welders", selections: ["user_usr_1"] }
    );
    expect(result.error?.category).toBe("forbidden");
  });
});

// Members are written with the service role, keyed on global user and group
// ids: each must be the company's.
describe("changing a group", () => {
  const editor = { users: { view: [COMPANY], update: [COMPANY] } };
  const company = (extra: Record<string, Row[]> = {}) => ({
    group: [
      { id: "grp_x", companyId: COMPANY },
      { id: "grp_y", companyId: COMPANY },
      { id: "grp_z", companyId: "cmp_2" }
    ],
    user: [
      { id: "usr_1", email: "usr_1@example.com" },
      { id: "usr_9", email: "usr_9@example.com" }
    ],
    employee: [
      { id: "usr_1", companyId: COMPANY },
      { id: "usr_9", companyId: "cmp_2" }
    ],
    ...extra
  });
  const update = (selections: string[], id = "grp_x") =>
    updateGroup(requestContext(editor, company()).ctx, {
      id,
      name: "Welders",
      selections
    });

  it("refuses a group that is not the company's", async () => {
    const result = await update(["user_usr_1"], "grp_z");
    expect(result.error?.category).toBe("notFound");
  });

  // Row-level security asked for update before the write bypassed it.
  it("refuses a user with users view alone", async () => {
    const result = await updateGroup(
      requestContext({ users: { view: [COMPANY] } }, company()).ctx,
      { id: "grp_x", name: "Welders", selections: ["user_usr_1"] }
    );
    expect(result.error?.category).toBe("forbidden");
  });

  it.each([
    ["a user of another company", ["user_usr_1", "user_usr_9"]],
    ["a group of another company", ["user_usr_1", "group_grp_z"]]
  ])("refuses %s as a member", async (_label, selections) => {
    const result = await update(selections);
    expect(result.error?.category).toBe("notFound");
  });

  it("refuses the group as its own member", async () => {
    const result = await update(["user_usr_1", "group_grp_x"]);
    expect(result.error?.category).toBe("validation");
  });

  it("renames the group and replaces its members once each, in the company", async () => {
    const { db, statements } = recordingDatabase([[{ id: "grp_x" }]]);
    const result = await updateGroup(
      requestContext(editor, company(), {}, db).ctx,
      {
        id: "grp_x",
        name: "Welders",
        selections: ["user_usr_1", "group_grp_y", "user_usr_1", "group_grp_y"]
      }
    );
    expect(result).toEqual({ data: { id: "grp_x" }, error: null });
    expect(statements()).toEqual([
      {
        sql: 'update "group" set "name" = $1, "updatedAt" = $2 where "id" = $3 and "companyId" = $4 returning "id"',
        parameters: ["Welders", expect.any(String), "grp_x", COMPANY]
      },
      {
        sql: 'delete from "membership" where "groupId" in (select "id" from "group" where "id" = $1 and "companyId" = $2)',
        parameters: ["grp_x", COMPANY]
      },
      {
        sql: 'insert into "membership" ("groupId", "memberGroupId", "memberUserId") values ($1, $2, $3), ($4, $5, $6)',
        parameters: ["grp_x", "grp_y", null, "grp_x", null, "usr_1"]
      }
    ]);
  });

  it("creates a group with its members once each", async () => {
    const { db, statements } = recordingDatabase([[{ id: "grp_new" }]]);
    const result = await createGroup(
      requestContext(
        { users: { create: [COMPANY], update: [COMPANY] } },
        company(),
        {},
        db
      ).ctx,
      { name: "Welders", selections: ["user_usr_1", "user_usr_1"] }
    );
    expect(result).toEqual({ data: { id: "grp_new" }, error: null });
    expect(statements()).toEqual([
      {
        sql: 'insert into "group" ("name", "companyId") values ($1, $2) returning "id"',
        parameters: ["Welders", COMPANY]
      },
      {
        sql: 'insert into "membership" ("groupId", "memberGroupId", "memberUserId") values ($1, $2, $3)',
        parameters: ["grp_new", null, "usr_1"]
      }
    ]);
  });
});

// Resending clears the invite's acceptance, and accepting it again merges
// the invite's grants back over what an admin removed since.
describe("sending an invite again", () => {
  const resend = (tables: Record<string, Row[]>, userIds: string[]) =>
    resendInvites(
      requestContext({ users: { create: [COMPANY] } }, tables).ctx,
      { userIds }
    );

  it.each([
    ["one user", ["usr_1"]],
    ["several users", ["usr_1", "usr_2"]]
  ])(
    "refuses %s when one has an active account in the company",
    async (_label, userIds) => {
      queued.length = 0;
      const tables = invitedEmployees(["usr_1", "usr_2"], {
        userToCompany: [{ userId: "usr_1", companyId: COMPANY }]
      });
      const accepted = "2026-11-01T00:00:00Z";
      Object.assign(tables.invite?.[0] ?? {}, { acceptedAt: accepted });
      const result = await resend(tables, userIds);
      expect(result.error?.category).toBe("rule");
      expect(queued).toEqual([]);
      expect(tables.invite?.[0]?.acceptedAt).toBe(accepted);
    }
  );

  // Deactivating a customer deletes the account the invite would activate.
  it("refuses a customer whose account was deactivated", async () => {
    queued.length = 0;
    const result = await resend(
      {
        user: [
          { id: "usr_1", email: "usr_1@example.com" },
          { id: "usr_2", email: "usr_2@example.com" }
        ],
        invite: [
          { email: "usr_1@example.com", companyId: COMPANY, role: "customer" },
          { email: "usr_2@example.com", companyId: COMPANY, role: "customer" }
        ],
        customerAccount: [{ id: "usr_2", companyId: COMPANY }]
      },
      ["usr_1", "usr_2"]
    );
    expect(result.error?.category).toBe("rule");
    expect(queued).toEqual([]);
  });

  it("refuses a user with no invite in the company", async () => {
    const result = await resend(
      invitedEmployees(["usr_1"], {
        user: [
          { id: "usr_1", email: "usr_1@example.com" },
          { id: "usr_9", email: "usr_9@example.com" }
        ]
      }),
      ["usr_1", "usr_9"]
    );
    expect(result.error?.category).toBe("notFound");
  });
});

// Deactivate acts on the ids it is sent: one from another company was
// answered "already deactivated", or queued for a job that changed nothing.
describe("deactivating users", () => {
  const deactivate = (tables: Record<string, Row[]>, userIds: string[]) =>
    deactivateUsers(
      requestContext({ users: { delete: [COMPANY] } }, tables).ctx,
      { userIds }
    );

  it("refuses a user who is not the company's", async () => {
    queued.length = 0;
    const result = await deactivate(
      {
        user: [
          { id: "usr_1", email: "a@example.com" },
          { id: "usr_9", email: "z@example.com" }
        ],
        userToCompany: [
          { userId: "usr_1", companyId: COMPANY },
          { userId: "usr_9", companyId: "cmp_2" }
        ],
        invite: [{ id: "inv_9", email: "z@example.com", companyId: "cmp_2" }]
      },
      ["usr_1", "usr_9"]
    );
    expect(result.error?.category).toBe("notFound");
    expect(queued).toEqual([]);
  });

  it("queues the company's members, employees, accounts and invitees", async () => {
    queued.length = 0;
    const result = await deactivate(
      {
        user: [
          { id: "usr_1", email: "a@example.com" },
          { id: "usr_2", email: "b@example.com" },
          { id: "usr_3", email: "c@example.com" },
          { id: "usr_4", email: "d@example.com" }
        ],
        userToCompany: [{ userId: "usr_1", companyId: COMPANY }],
        employee: [{ id: "usr_2", companyId: COMPANY }],
        invite: [{ id: "inv_3", email: "c@example.com", companyId: COMPANY }],
        customerAccount: [{ id: "usr_4", companyId: COMPANY }]
      },
      ["usr_1", "usr_2", "usr_3", "usr_4"]
    );
    expect(result.data?.queued).toBe(true);
    expect(
      queued.flatMap(({ events }) =>
        (events as { payload: { id: string } }[]).map((e) => e.payload.id)
      )
    ).toEqual(["usr_1", "usr_2", "usr_3", "usr_4"]);
  });
});

// A second account insert fails, and its rollback deactivated the account
// the person already had: a removal under `create: users`.
describe("inviting a portal contact", () => {
  const contactTables = (
    extra: Record<string, Row[]> = {}
  ): Record<string, Row[]> => ({
    customerContact: [
      {
        id: "cc_1",
        companyId: COMPANY,
        customerId: "cus_1",
        contact: { email: "Pat@Example.com" }
      }
    ],
    supplierContact: [
      {
        id: "sc_1",
        companyId: COMPANY,
        supplierId: "sup_1",
        contact: { email: "Pat@Example.com" }
      }
    ],
    user: [{ id: "usr_1", email: "pat@example.com" }],
    ...extra
  });
  const portalGrants = {
    view: [COMPANY],
    create: [COMPANY],
    update: [COMPANY]
  };
  const admin = {
    users: { create: [COMPANY] },
    sales: portalGrants,
    purchasing: portalGrants
  };
  const inviteCustomer = (
    tables: Record<string, Row[]>,
    customerId = "cus_1"
  ) =>
    inviteCustomerContact(requestContext(admin, tables).ctx, {
      customerContactId: "cc_1",
      customerId
    });

  it.each([
    [
      "a customer account",
      { customerAccount: [{ id: "usr_1", companyId: COMPANY }] }
    ],
    [
      "a membership",
      { userToCompany: [{ userId: "usr_1", companyId: COMPANY }] }
    ]
  ])(
    "refuses a customer contact whose person has %s in the company",
    async (_label, extra) => {
      const result = await inviteCustomer(contactTables(extra));
      expect(result.error?.category).toBe("conflict");
    }
  );

  // The invite is upserted on (email, company): it would take the portal
  // role and permissions in place of the pending employee invite.
  it("refuses a contact whose person has a pending invite in the company", async () => {
    const tables = contactTables({
      invite: [
        { email: "pat@example.com", companyId: COMPANY, role: "employee" }
      ]
    });
    const result = await inviteCustomer(tables);
    expect(result.error?.category).toBe("conflict");
    expect(tables.invite?.[0]?.role).toBe("employee");
  });

  // The account and the invite are written beside each other: a write the
  // caller's row-level security refuses leaves the invite redeemable.
  it("refuses a user without sales create, update and view", async () => {
    const result = await inviteCustomerContact(
      requestContext({ users: { create: [COMPANY] } }, contactTables()).ctx,
      { customerContactId: "cc_1", customerId: "cus_1" }
    );
    expect(result.error?.category).toBe("forbidden");
  });

  it("refuses a supplier contact whose person has a supplier account in the company", async () => {
    const result = await inviteSupplierContact(
      requestContext(
        admin,
        contactTables({
          supplierAccount: [{ id: "usr_1", companyId: COMPANY }]
        })
      ).ctx,
      { supplierContactId: "sc_1", supplierId: "sup_1" }
    );
    expect(result.error?.category).toBe("conflict");
  });

  it("refuses a contact of another customer", async () => {
    const result = await inviteCustomer(contactTables(), "cus_2");
    expect(result.error?.category).toBe("notFound");
  });

  it("lets a person with an account only in another company be invited", async () => {
    const { ctx } = requestContext(
      admin,
      contactTables({
        customerAccount: [{ id: "usr_1", companyId: "cmp_2" }],
        userToCompany: [{ userId: "usr_1", companyId: "cmp_2" }]
      })
    );
    expect(
      await refuseUninvitableContact(ctx, {
        role: "customer",
        id: "cc_1",
        customerId: "cus_1"
      })
    ).toBeNull();
  });

  // The account and the contact's user link are written under RLS.
  it.each([
    [
      "customer",
      () =>
        inviteCustomerContact(keyContext(usersScopes({ create: [COMPANY] })), {
          customerContactId: "cc_1",
          customerId: "cus_1"
        })
    ],
    [
      "supplier",
      () =>
        inviteSupplierContact(keyContext(usersScopes({ create: [COMPANY] })), {
          supplierContactId: "sc_1",
          supplierId: "sup_1"
        })
    ]
  ])(
    "refuses a %s invite from a key with users create alone",
    async (_label, invite) => {
      const result = await invite();
      expect(result.error?.category).toBe("forbidden");
    }
  );
});

describe("reading an employee's permissions", () => {
  const claims = {
    role: "employee",
    sales_view: [COMPANY, "cmp_2"],
    sales_update: ["cmp_2"],
    users_view: [COMPANY]
  };
  const read = (tables: Record<string, Row[]>) =>
    getEmployeePermissions(
      requestContext({ users: { view: [COMPANY] } }, tables, {
        get_claims: claims
      }).ctx,
      { id: "usr_1" }
    );

  it("returns this company's grants by module, the shape the permission edits take", async () => {
    const result = await read({
      employees: [
        {
          id: "usr_1",
          companyId: COMPANY,
          name: "Pat Doe",
          employeeTypeId: "et_1"
        }
      ]
    });
    expect(result).toEqual({
      data: {
        id: "usr_1",
        name: "Pat Doe",
        employeeTypeId: "et_1",
        permissions: {
          sales: { view: true, create: false, update: false, delete: false },
          users: { view: true, create: false, update: false, delete: false }
        }
      },
      error: null
    });
  });

  it("refuses a user who is not an employee of the company", async () => {
    const result = await read({
      employees: [
        {
          id: "usr_1",
          companyId: "cmp_2",
          name: "Pat Doe",
          employeeTypeId: "et_9"
        }
      ]
    });
    expect(result.error?.category).toBe("notFound");
  });
});
