// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createServiceContext } from "@carbon/api/service-fn.server";
import {
  claimsFor,
  type ExpandedClaims,
  type Grant,
  type Level,
  levelOf,
  MODULES,
  PAGES
} from "@carbon/database/access";
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
import { pageClaims } from "../../../test/page-claims";

// The job runner is Inngest over the network: keep what would be sent.
const queued = vi.hoisted(() => [] as { name: string; events: unknown[] }[]);
vi.mock("@carbon/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/jobs")>()),
  batchTrigger: vi.fn(async (name: string, events: unknown[]) => {
    queued.push({ name, events });
  }),
  trigger: vi.fn(async () => undefined)
}));
// The plan lookup: this company may author roles.
vi.mock("@carbon/ee/plan.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/ee/plan.server")>()),
  companyHasFeature: vi.fn(async () => true)
}));
// Redis is over the network: deactivating clears the cached claims there.
vi.mock("@carbon/kv", () => ({ redis: { del: vi.fn(async () => 1) } }));

import { batchTrigger } from "@carbon/jobs";
import { redis } from "@carbon/kv";
import { nonOperatorPinResetPermission } from "./users.models";
import {
  bulkUpdatePermissions,
  certifyItarEntity,
  createGroup,
  deactivateUsers,
  inviteCustomerContact,
  inviteEmployee,
  inviteSupplierContact,
  resendInvites,
  revokeInvites,
  updateGroup
} from "./users.server";
import {
  type CompanyTie,
  canReAddDeactivatedEmployee,
  companyUsersRefusal,
  pinResetRefusal,
  readInviteRevocations,
  refuseUninvitableContact,
  reinviteRevocations,
  revocableInvites
} from "./users.service";

const COMPANY = "cmp_1";

describe("canReAddDeactivatedEmployee", () => {
  const level = (actions: Partial<Record<"create" | "update", string[]>>) => ({
    view: [],
    create: [],
    update: [],
    delete: [],
    ...actions
  });
  const accountsEdit = { "users.accounts": level({ update: [COMPANY] }) };
  const employeesCreate = { "people.employees": level({ create: [COMPANY] }) };

  it("allows an inviter with Edit on Accounts and Create on Employees", () => {
    expect(
      canReAddDeactivatedEmployee(
        { ...accountsEdit, ...employeesCreate },
        COMPANY
      )
    ).toBe(true);
  });

  it.each([
    ["Edit on Accounts alone", accountsEdit],
    ["Create on Employees alone", employeesCreate],
    [
      "Create, not Edit, on Accounts",
      { "users.accounts": level({ create: [COMPANY] }), ...employeesCreate }
    ],
    [
      "both, for another company",
      {
        "users.accounts": level({ update: ["cmp_2"] }),
        "people.employees": level({ create: ["cmp_2"] })
      }
    ],
    [
      "Edit on every other Users page",
      {
        "users.operators": level({ update: [COMPANY] }),
        "users.groups": level({ update: [COMPANY] }),
        "users.employeeTypes": level({ update: [COMPANY] }),
        ...employeesCreate
      }
    ],
    [
      "Create on every other People page",
      {
        ...accountsEdit,
        "people.timecards": level({ create: [COMPANY] }),
        "people.attributes": level({ create: [COMPANY] }),
        "people.departments": level({ create: [COMPANY] }),
        "people.holidays": level({ create: [COMPANY] }),
        "people.shifts": level({ create: [COMPANY] }),
        "people.payrollTotals": level({ create: [COMPANY] })
      }
    ],
    ["unreadable claims", null]
  ])("refuses an inviter with %s", (_label, permissions) => {
    expect(canReAddDeactivatedEmployee(permissions, COMPANY)).toBe(false);
  });
});

const unreachable = () => {
  throw new Error("must not be reached");
};

/** A user in COMPANY holding `permissions`; the caller client returns `user`. */
function userContext(
  permissions: ExpandedClaims,
  user: Record<string, unknown> | null = null
) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    single: async () =>
      user ? { data: user, error: null } : { data: null, error: {} }
  };
  return createServiceContext({
    actor: {
      type: "user",
      userId: "usr_admin",
      permissions: pageClaims(permissions),
      role: "employee"
    },
    company: { id: COMPANY, groupId: "grp_1" },
    caller: { from: () => chain } as never,
    system: unreachable as never,
    pg: unreachable as never,
    kv: unreachable as never
  });
}

describe("operation guards", () => {
  it("refuses deactivating the caller's own account", async () => {
    const result = await deactivateUsers(
      userContext({
        users: { view: [], create: [], update: [], delete: [COMPANY] }
      }),
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
        permissions: pageClaims({
          users: { view: [], create: [], update: [COMPANY], delete: [] }
        })
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
 * RPCs they call (answering `rpcResults[name]`, else 1). `afterRead` runs
 * after each read has its rows: what another request commits in between.
 */
function memoryClient(
  tables: Record<string, Row[]>,
  rpcResults: Record<string, unknown> = {},
  afterRead: (table: string) => void = () => undefined
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
      const data = rows.map((row) => ({ ...row }));
      if (!patch && !remove) afterRead(table);
      return { data, error: null };
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

type ModuleGrants = Record<
  string,
  Partial<Record<"view" | "create" | "update" | "delete", string[]>>
>;

/** Grants written per module, as every page of the module holds them. */
const claimsOf = (modules: ModuleGrants): ExpandedClaims =>
  pageClaims(
    Object.fromEntries(
      Object.entries(modules).map(([module, actions]) => [
        module,
        { view: [], create: [], update: [], delete: [], ...actions }
      ])
    )
  );

/**
 * A user in COMPANY whose request came from ORIGIN, over `tables`. Without
 * `pg`, every statement finds no rows: no one acted on is an Admin.
 */
function requestContext(
  permissions: ModuleGrants,
  tables: Record<string, Row[]> = {},
  rpcResults: Record<string, unknown> = {},
  pg: Kysely<KyselyDatabase> | null = null,
  afterRead?: (table: string) => void
) {
  const system = memoryClient(tables, rpcResults, afterRead);
  const db = pg ?? recordingDatabase([]).db;
  const ctx = createServiceContext({
    actor: {
      type: "user",
      userId: "usr_admin",
      role: "employee",
      permissions: claimsOf(permissions)
    },
    company: { id: COMPANY, groupId: "grp_1" },
    origin: ORIGIN,
    caller: {} as never,
    system: () => system.client as never,
    pg: () => db,
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
        // oxlint-disable-next-line require-yield -- never streamed
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

/**
 * The person accepts their invite right after the first read of `table`, as
 * `acceptInvite` commits it: the invite stamped accepted, the membership
 * added and the employee active, together.
 */
function acceptsAfterReading(
  tables: Record<string, Row[]>,
  userId: string,
  table: string
) {
  let accepted = false;
  return (read: string) => {
    if (accepted || read !== table) return;
    accepted = true;
    const invite = tables.invite?.find(
      (row) => row.email === `${userId}@example.com`
    );
    Object.assign(invite ?? {}, {
      acceptedAt: "2026-11-24T10:00:00.000000+00:00"
    });
    tables.userToCompany = [
      ...(tables.userToCompany ?? []),
      { userId, companyId: COMPANY, role: "employee" }
    ];
    for (const employee of tables.employee ?? []) {
      if (employee.id === userId) employee.active = true;
    }
  };
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
            ip: "203.0.113.9",
            revokedAt: null
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
    const grants = [{ module: "Sales", page: null, level: "View" }];
    await bulkUpdatePermissions(ctx, {
      editType: "add",
      userIds: ["usr_1"],
      grants,
      ...forged
    } as never);
    expect(queued).toEqual([
      {
        name: "update-permissions",
        events: [
          {
            payload: {
              id: "usr_1",
              grants,
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
    const tables: Record<string, Row[]> = {
      user: [
        { id: "usr_1", email: "a@example.com" },
        { id: "usr_2", email: "b@example.com" }
      ],
      invite: [
        { id: "inv_1", email: "a@example.com", companyId: COMPANY },
        { id: "inv_2", email: "b@example.com", companyId: COMPANY }
      ]
    };
    const { ctx, rpcs } = requestContext(
      { users: { delete: [COMPANY] } },
      tables
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
          ip: "203.0.113.9",
          revokedAt: tables.invite?.[0]?.revokedAt
        }
      }))
    );
  });
});

// Revoking deactivates the user, and deactivating an account needs Full.
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

  // The lists show Revoke Invite only with Full on Accounts.
  it("refuses a caller with Create on Accounts alone", async () => {
    const result = await revokeInvites(
      requestContext({ users: { create: [COMPANY] } }, invited()).ctx,
      { userIds: ["usr_1"] }
    );
    expect(result.error?.category).toBe("forbidden");
  });

  it("revokes one user's invite and deactivates them", async () => {
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

  // The revoke is decided at its write: an acceptance after the check keeps
  // the account active and the invite accepted.
  it("leaves an invite accepted after the check, and its account, alone", async () => {
    queued.length = 0;
    const tables = invitedEmployees(["usr_1"]);
    const { ctx } = requestContext(
      { users: { delete: [COMPANY] } },
      tables,
      {},
      null,
      acceptsAfterReading(tables, "usr_1", "userToCompany")
    );

    const result = await revokeInvites(ctx, { userIds: ["usr_1"] });

    expect(result).toEqual({ data: { revoked: 0 }, error: null });
    expect(tables.userToCompany).toEqual([
      { userId: "usr_1", companyId: COMPANY, role: "employee" }
    ]);
    expect(tables.employee).toEqual([
      { id: "usr_1", companyId: COMPANY, active: true }
    ]);
    expect(tables.invite?.[0]?.revokedAt).toBeUndefined();
  });

  it("queues a deactivation only for the invites it revoked", async () => {
    queued.length = 0;
    const tables = invitedEmployees(["usr_1", "usr_2", "usr_3"]);
    const { ctx } = requestContext(
      { users: { delete: [COMPANY] } },
      tables,
      {},
      null,
      acceptsAfterReading(tables, "usr_1", "userToCompany")
    );

    const result = await revokeInvites(ctx, {
      userIds: ["usr_1", "usr_2", "usr_3"]
    });

    expect(result).toEqual({ data: { revoked: 2 }, error: null });
    expect(queued).toEqual([
      {
        name: "user-admin",
        events: ["usr_2", "usr_3"].map((id) => ({
          payload: {
            id,
            type: "deactivate",
            companyId: COMPANY,
            actorId: "usr_admin",
            ip: "203.0.113.9",
            revokedAt: tables.invite?.[1]?.revokedAt
          }
        }))
      }
    ]);
    expect(tables.invite?.[0]?.revokedAt).toBeUndefined();
  });

  // Clearing the cached claims comes after the account writes: a failure
  // there keeps the invite revoked, and the job runs the deactivation again.
  it("hands a deactivation that threw after its writes to the job", async () => {
    queued.length = 0;
    vi.mocked(redis.del).mockRejectedValueOnce(new Error("Redis is down"));
    const tables = invitedEmployees(["usr_1"]);
    const { ctx, rpcs } = requestContext(
      { users: { delete: [COMPANY] } },
      tables
    );

    const result = await revokeInvites(ctx, { userIds: ["usr_1"] });

    expect(result).toEqual({ data: { revoked: 1 }, error: null });
    expect(tables.invite?.[0]?.revokedAt).toEqual(expect.any(String));
    expect(queued).toEqual([
      {
        name: "user-admin",
        events: [
          {
            payload: {
              id: "usr_1",
              type: "deactivate",
              companyId: COMPANY,
              actorId: "usr_admin",
              ip: "203.0.113.9",
              revokedAt: tables.invite?.[0]?.revokedAt
            }
          }
        ]
      }
    ]);
    const audit = rpcs.find((call) => call.name === "insert_audit_log_batch");
    expect(
      (audit?.args.p_entries as { entityId: unknown }[]).map(
        (entry) => entry.entityId
      )
    ).toEqual(["inv_usr_1"]);
  });

  // The send can reject after Inngest accepted the events: an invite whose
  // deactivation may still run is never reopened, and the revoke sent again
  // queues the deactivations without revoking again.
  it("keeps the invites revoked when queuing their deactivation fails, and finishes on a second revoke", async () => {
    queued.length = 0;
    vi.mocked(batchTrigger).mockRejectedValueOnce(new Error("Timed out"));
    const tables = invitedEmployees(["usr_1", "usr_2"]);
    const { ctx, rpcs } = requestContext(
      { users: { delete: [COMPANY] } },
      tables
    );

    const result = await revokeInvites(ctx, { userIds: ["usr_1", "usr_2"] });

    expect(result.error?.category).toBe("internal");
    const stamps = tables.invite?.map((invite) => invite.revokedAt);
    expect(stamps).toEqual([expect.any(String), expect.any(String)]);
    const audit = rpcs.filter((call) => call.name === "insert_audit_log_batch");
    expect(
      audit.flatMap((call) =>
        (call.args.p_entries as { entityId: unknown }[]).map(
          (entry) => entry.entityId
        )
      )
    ).toEqual(["inv_usr_1", "inv_usr_2"]);

    const retried = await revokeInvites(ctx, { userIds: ["usr_1", "usr_2"] });

    expect(retried).toEqual({ data: { revoked: 0 }, error: null });
    expect(tables.invite?.map((invite) => invite.revokedAt)).toEqual(stamps);
    expect(queued).toEqual([
      {
        name: "user-admin",
        events: ["usr_1", "usr_2"].map((id, index) => ({
          payload: {
            id,
            type: "deactivate",
            companyId: COMPANY,
            actorId: "usr_admin",
            ip: "203.0.113.9",
            revokedAt: stamps?.[index]
          }
        }))
      }
    ]);
    expect(
      rpcs.filter((call) => call.name === "insert_audit_log_batch")
    ).toHaveLength(1);
  });

  // The person keeps groups, overrides or a portal account until the
  // deactivation runs; running it again removes them.
  it("deactivates the user of an invite revoked earlier and never accepted, without revoking it again", async () => {
    queued.length = 0;
    const tables = invitedEmployees(["usr_1"], {
      group: [{ id: "grp_sales", companyId: COMPANY }],
      membership: [{ groupId: "grp_sales", memberUserId: "usr_1" }],
      permission: [{ userId: "usr_1", companyId: COMPANY, module: "Sales" }]
    });
    tables.invite![0]!.revokedAt = "2026-11-20T08:00:00.000+00:00";

    const result = await revoke(tables);

    expect(result).toEqual({ data: { revoked: 0 }, error: null });
    expect(tables.invite?.[0]?.revokedAt).toBe("2026-11-20T08:00:00.000+00:00");
    expect(tables.membership).toEqual([]);
    expect(tables.permission).toEqual([]);
    expect(queued).toEqual([]);
  });

  it("refuses a user who has an account in the company", async () => {
    const result = await revoke(
      invited({ userToCompany: [{ userId: "usr_1", companyId: COMPANY }] })
    );
    expect(result.error?.category).toBe("rule");
  });

  it.each([
    ["accepted", { acceptedAt: "2026-11-01T00:00:00Z" }],
    [
      "accepted and then deactivated",
      { acceptedAt: "2026-11-01T00:00:00Z", revokedAt: "2026-11-02T00:00:00Z" }
    ]
  ])("refuses a user whose invite is %s", async (_label, change) => {
    const result = await revoke({
      user: [{ id: "usr_1", email: "a@example.com" }],
      invite: [
        { id: "inv_1", email: "a@example.com", companyId: COMPANY, ...change }
      ]
    });
    expect(result.error?.category).toBe("rule");
  });

  // The user is read across companies: their email is not the caller's to see.
  it("refuses a user invited only to another company without naming them", async () => {
    const result = await revoke({
      user: [{ id: "usr_1", email: "a@example.com" }],
      invite: [{ id: "inv_1", email: "a@example.com", companyId: "cmp_2" }]
    });
    expect(result.error?.category).toBe("notFound");
    expect(result.error?.message).not.toContain("a@example.com");
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
const keyContext = (scopes: ModuleGrants) =>
  createServiceContext({
    actor: {
      type: "apiKey",
      createdBy: "usr_admin",
      permissions: claimsOf(scopes)
    },
    company: { id: COMPANY, groupId: "grp_1" },
    caller: unreachable as never,
    system: unreachable as never,
    pg: unreachable as never,
    kv: unreachable as never
  });

describe("API key scopes beyond the gate", () => {
  // A first-time invite inserts the employee under RLS, and a re-add checks
  // the key creator's claims: the key itself must hold both.
  it("refuses an invite from a key with Create on Accounts alone", async () => {
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

  // A read-only key must not write.
  it("refuses a group change from a key with View on Groups alone", async () => {
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

  // Row-level security asks Edit of a member write, which bypasses it.
  it("refuses a user with View on Groups alone", async () => {
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
  const REVOKED_AT = "2026-11-24T11:00:00.000000+00:00";
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

  // The single resend refreshes the invite only while the person has no
  // account: an acceptance after the check gets no new code and no email.
  it("refuses an invite accepted after the check and keeps its code", async () => {
    const tables = invitedEmployees(["usr_1"], {
      company: [{ id: COMPANY, name: "Acme" }]
    });
    Object.assign(tables.invite?.[0] ?? {}, { code: "code-sent" });
    const { ctx } = requestContext(
      { users: { create: [COMPANY] } },
      tables,
      {},
      null,
      acceptsAfterReading(tables, "usr_1", "company")
    );

    const result = await resendInvites(ctx, { userIds: ["usr_1"] });

    expect(result.error?.category).toBe("rule");
    expect(tables.invite?.[0]).toMatchObject({
      code: "code-sent",
      acceptedAt: "2026-11-24T10:00:00.000000+00:00"
    });
  });

  // A user sent twice is one user: one refreshed invite, no queued resends.
  it("re-invites a user sent twice once, at once", async () => {
    queued.length = 0;
    const tables = invitedEmployees(["usr_1"], {
      company: [{ id: COMPANY, name: "Acme" }]
    });

    const result = await resend(tables, ["usr_1", "usr_1"]);

    expect(result).toEqual({ data: { queued: false }, error: null });
    expect(queued).toEqual([]);
    expect(tables.invite?.[0]?.code).toEqual(expect.any(String));
  });

  // The job runs later: it may clear only the revocation the request saw.
  it("queues each invite's revocation as the request read it", async () => {
    queued.length = 0;
    const tables = invitedEmployees(["usr_1", "usr_2"]);
    Object.assign(tables.invite?.[1] ?? {}, { revokedAt: REVOKED_AT });

    const result = await resend(tables, ["usr_1", "usr_2"]);

    expect(result).toEqual({ data: { queued: true }, error: null });
    expect(
      queued.flatMap(({ events }) =>
        (events as { payload: { id: string; revokedAt: unknown } }[]).map(
          ({ payload }) => [payload.id, payload.revokedAt]
        )
      )
    ).toEqual([
      ["usr_1", null],
      ["usr_2", REVOKED_AT]
    ]);
  });

  // A revoke after the check keeps the invite revoked: no new code, no email.
  it("refuses an invite revoked after the check and keeps it revoked", async () => {
    const tables = invitedEmployees(["usr_1"], {
      company: [{ id: COMPANY, name: "Acme" }]
    });
    Object.assign(tables.invite?.[0] ?? {}, { code: "code-sent" });
    const { ctx } = requestContext(
      { users: { create: [COMPANY] } },
      tables,
      {},
      null,
      (read) => {
        if (read === "company") {
          Object.assign(tables.invite?.[0] ?? {}, { revokedAt: REVOKED_AT });
        }
      }
    );

    const result = await resendInvites(ctx, { userIds: ["usr_1"] });

    expect(result.error?.category).toBe("conflict");
    expect(tables.invite?.[0]).toMatchObject({
      code: "code-sent",
      revokedAt: REVOKED_AT
    });
  });

  // The table's bulk Send Invites queues through this read: another
  // company's invite says nothing about this one.
  it("reads each user's revocation from the company's invite", async () => {
    const tables = invitedEmployees(["usr_1", "usr_2"]);
    Object.assign(tables.invite?.[0] ?? {}, { companyId: "cmp_2" });
    tables.invite?.push({
      id: "inv_usr_1_here",
      email: "usr_1@example.com",
      companyId: COMPANY,
      revokedAt: REVOKED_AT
    });

    const revokedAt = await readInviteRevocations(
      memoryClient(tables).client as never,
      COMPANY,
      ["usr_1", "usr_2", "usr_1"]
    );

    expect([...revokedAt]).toEqual([
      ["usr_1", REVOKED_AT],
      ["usr_2", null]
    ]);
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

// The checks Revoke, Resend and Deactivate make on what `readCompanyTies` read.
describe("checks on a user's ties to the company", () => {
  const NO_ACCOUNTS = { employee: false, customer: false, supplier: false };
  const tie = (overrides: Partial<CompanyTie> = {}): CompanyTie => ({
    userId: "usr_1",
    email: "usr_1@example.com",
    isMember: false,
    accounts: { ...NO_ACCOUNTS, employee: true },
    invite: {
      id: "inv_1",
      role: "employee",
      acceptedAt: null,
      revokedAt: null
    },
    ...overrides
  });
  const ACCEPTED = "2026-11-01T00:00:00Z";
  const REVOKED = "2026-11-02T00:00:00Z";

  describe("revocableInvites", () => {
    it("takes pending and earlier revoked invites", () => {
      const ties = [
        tie(),
        tie({
          userId: "usr_2",
          invite: {
            id: "inv_2",
            role: "employee",
            acceptedAt: null,
            revokedAt: REVOKED
          }
        })
      ];
      expect(revocableInvites(ties, ["usr_1", "usr_2"])).toEqual({
        data: [
          { userId: "usr_1", inviteId: "inv_1", revokedAt: null },
          { userId: "usr_2", inviteId: "inv_2", revokedAt: REVOKED }
        ],
        error: null
      });
    });

    it.each([
      ["an id that names no one", [tie()], ["usr_1", "usr_9"]],
      ["a user with no tie here", [tie({ invite: null })], ["usr_1"]]
    ])("does not find %s", (_label, ties, ids) => {
      const { error } = revocableInvites(ties, ids);
      expect(error?.category).toBe("notFound");
      expect(error?.message).toBe("User not found");
    });

    it("names every user it refuses", () => {
      const { error } = revocableInvites(
        [
          tie({ isMember: true }),
          tie({
            userId: "usr_2",
            email: "usr_2@example.com",
            invite: {
              id: "inv_2",
              role: "employee",
              acceptedAt: ACCEPTED,
              revokedAt: REVOKED
            }
          }),
          tie({
            userId: "usr_3",
            email: "usr_3@example.com",
            invite: {
              id: "inv_3",
              role: "employee",
              acceptedAt: ACCEPTED,
              revokedAt: null
            }
          })
        ],
        ["usr_1", "usr_2", "usr_3"]
      );
      expect(error?.category).toBe("rule");
      expect(error?.message).toBe(
        "Only a pending invite can be revoked: usr_1@example.com has an active account: deactivate it instead; usr_2@example.com was deactivated; usr_3@example.com accepted their invite."
      );
    });
  });

  describe("reinviteRevocations", () => {
    it("answers each user's revocation", () => {
      const ties = [
        tie({
          invite: {
            id: "inv_1",
            role: "employee",
            acceptedAt: ACCEPTED,
            revokedAt: REVOKED
          }
        }),
        tie({ userId: "usr_2" })
      ];
      expect([
        ...(reinviteRevocations(ties, ["usr_1", "usr_2"]).data ?? [])
      ]).toEqual([
        ["usr_1", REVOKED],
        ["usr_2", null]
      ]);
    });

    it.each([
      [
        "an id that names no one",
        [tie()],
        ["usr_1", "usr_9"],
        "User not found"
      ],
      [
        "a user with no invite here",
        [tie({ invite: null })],
        ["usr_1"],
        "No invite record found for user"
      ]
    ])("does not find %s", (_label, ties, ids, message) => {
      const { error } = reinviteRevocations(ties, ids);
      expect(error?.category).toBe("notFound");
      expect(error?.message).toBe(message);
    });

    it("refuses an active account", () => {
      const { error } = reinviteRevocations(
        [tie({ isMember: true })],
        ["usr_1"]
      );
      expect(error?.category).toBe("rule");
      expect(error?.message).toBe(
        "usr_1@example.com already has an active account in the company. An invite is sent again only to an invited or deactivated person."
      );
    });

    it("refuses a contact whose customer account was deactivated", () => {
      const { error } = reinviteRevocations(
        [
          tie({
            accounts: NO_ACCOUNTS,
            invite: {
              id: "inv_1",
              role: "customer",
              acceptedAt: ACCEPTED,
              revokedAt: REVOKED
            }
          })
        ],
        ["usr_1"]
      );
      expect(error?.category).toBe("rule");
      expect(error?.message).toBe(
        "usr_1@example.com: the customer or supplier account was deactivated. Invite the contact again from the customer's or supplier's contacts."
      );
    });
  });

  describe("companyUsersRefusal", () => {
    it.each([
      [
        "a membership",
        tie({ isMember: true, accounts: NO_ACCOUNTS, invite: null })
      ],
      ["an account", tie({ invite: null })],
      ["an invite", tie({ accounts: NO_ACCOUNTS })]
    ])("takes a user with %s here", (_label, userTie) => {
      expect(companyUsersRefusal([userTie], ["usr_1"])).toBeNull();
    });

    it.each([
      ["an id that names no one", [tie()], ["usr_1", "usr_9"]],
      [
        "a user with no tie here",
        [tie({ accounts: NO_ACCOUNTS, invite: null })],
        ["usr_1"]
      ]
    ])("does not find %s", (_label, ties, ids) => {
      expect(companyUsersRefusal(ties, ids)?.category).toBe("notFound");
    });
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
// the person already had: a removal under Create on Accounts.
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
  it("refuses a user without Edit on Customers", async () => {
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
    "refuses a %s invite from a key with Create on Accounts alone",
    async (_label, invite) => {
      const result = await invite();
      expect(result.error?.category).toBe("forbidden");
    }
  );
});

describe("pinResetRefusal", () => {
  const grant = (
    subject: Grant["subject"],
    module: string,
    page: string | null,
    level: Level
  ): Grant => ({ subject, module, page, level });
  const user = (grants: Grant[], admin = false) => ({
    type: "user" as const,
    userId: "usr_actor",
    role: "employee" as const,
    permissions: claimsFor({ role: "employee", admin, grants }, COMPANY)
      .permissions
  });
  const target = (
    type: { systemType: string | null; isConsoleOperator: boolean },
    grants: Grant[],
    admin = false
  ) => ({
    ...type,
    employeeTypeCompanyId: COMPANY,
    admin,
    levels: PAGES.map((page) => ({
      page: page.id,
      level: levelOf({ admin, grants }, page.id).level
    }))
  });
  const operatorType = {
    systemType: "Console Operator",
    isConsoleOperator: true
  };
  // The Console Operator type's grants (`CONSOLE_OPERATOR_GRANTS`, @carbon/ee).
  const operatorGrants = (subject: Grant["subject"]) => [
    grant(subject, "Production", null, "Edit"),
    grant(subject, "Inventory", null, "Edit"),
    grant(subject, "Quality", null, "Edit"),
    grant(subject, "Resources", null, "View"),
    grant(subject, "People", null, "View")
  ];
  const operatorsEdit = grant("role", "Users", "users.operators", "Edit");
  const accountsEdit = grant("role", "Users", "users.accounts", "Edit");
  const peopleEdit = grant("role", "Settings", "settings.people", "Edit");

  it("refuses a non-Admin resetting an Admin's PIN", () => {
    const admin = target(
      { systemType: "Admin", isConsoleOperator: false },
      [],
      true
    );
    expect(
      pinResetRefusal({
        actor: user([operatorsEdit, accountsEdit, peopleEdit]),
        actorIsAdmin: false,
        companyId: COMPANY,
        target: admin
      })
    ).toBe("Only an Admin can reset an Admin's PIN");
  });

  it("refuses a non-Admin holding Full on every module resetting an Admin's PIN", () => {
    const everything = MODULES.map((module) =>
      grant("role", module.enum, null, "Full")
    );
    expect(
      pinResetRefusal({
        actor: user(everything),
        actorIsAdmin: false,
        companyId: COMPANY,
        target: target(
          { systemType: "Admin", isConsoleOperator: false },
          [],
          true
        )
      })
    ).toBe("Only an Admin can reset an Admin's PIN");
  });

  it("refuses Operators Edit alone resetting an operator moved to another type", () => {
    // Still flagged a console operator, but no longer the Console Operator
    // type, and holding nothing the actor lacks.
    const raised = target({ systemType: null, isConsoleOperator: true }, [
      grant("role", "Users", "users.operators", "View")
    ]);
    expect(
      pinResetRefusal({
        actor: user([operatorsEdit]),
        actorIsAdmin: false,
        companyId: COMPANY,
        target: raised
      })
    ).toMatch(/not a console operator/);
  });

  it("refuses Operators and People Edit without Accounts Edit resetting a non-operator", () => {
    const employee = target({ systemType: null, isConsoleOperator: false }, [
      grant("role", "Users", "users.operators", "View")
    ]);
    expect(
      pinResetRefusal({
        actor: user([operatorsEdit, peopleEdit]),
        actorIsAdmin: false,
        companyId: COMPANY,
        target: employee
      })
    ).toMatch(/not a console operator/);
    expect(
      pinResetRefusal({
        actor: user([operatorsEdit, accountsEdit, peopleEdit]),
        actorIsAdmin: false,
        companyId: COMPANY,
        target: employee
      })
    ).toBeNull();
  });

  // The Employees "Set Console PIN" item checks the same constant.
  it("admits a non-operator's reset with exactly nonOperatorPinResetPermission, and no fewer", () => {
    const gate = Object.entries(nonOperatorPinResetPermission).map(
      ([page, level]) =>
        grant(
          "role",
          MODULES.find((m) => m.id === page.split(".")[0])!.enum,
          page,
          level
        )
    );
    expect(gate.length).toBeGreaterThan(1);
    const employee = target({ systemType: null, isConsoleOperator: false }, []);
    const reset = (grants: Grant[]) =>
      pinResetRefusal({
        actor: user([operatorsEdit, ...grants]),
        actorIsAdmin: false,
        companyId: COMPANY,
        target: employee
      });
    expect(reset(gate)).toBeNull();
    for (const missing of gate) {
      expect(reset(gate.filter((g) => g !== missing))).toMatch(
        /not a console operator/
      );
    }
  });

  it("refuses resetting the PIN of someone holding more than the actor", () => {
    expect(
      pinResetRefusal({
        actor: user([operatorsEdit]),
        actorIsAdmin: false,
        companyId: COMPANY,
        target: target(operatorType, operatorGrants("role"))
      })
    ).toMatch(/more access than you/);
  });

  it("allows Operators Edit resetting a real console operator's PIN", () => {
    expect(
      pinResetRefusal({
        actor: user([operatorsEdit, ...operatorGrants("role")]),
        actorIsAdmin: false,
        companyId: COMPANY,
        target: target(operatorType, operatorGrants("role"))
      })
    ).toBeNull();
  });

  it("allows an Admin resetting anyone's PIN", () => {
    const admin = user([], true);
    for (const someone of [
      target({ systemType: "Admin", isConsoleOperator: false }, [], true),
      target({ systemType: null, isConsoleOperator: true }, [
        grant("person", "Accounting", null, "Full")
      ]),
      target(operatorType, operatorGrants("role"))
    ]) {
      expect(
        pinResetRefusal({
          actor: admin,
          actorIsAdmin: true,
          companyId: COMPANY,
          target: someone
        })
      ).toBeNull();
    }
  });
});
