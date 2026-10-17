// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CompiledQuery, DatabaseConnection, Driver } from "kysely";
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler
} from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

// users.server pulls in auth, SSO, Redis and two module barrels at import
// time. Everything createEmployeeAccount and acceptInvite do not exercise is
// stubbed; the parts they do are recorded so each test can assert on which
// writes ran and through which client.
const mocks = vi.hoisted(() => ({
  deactivateEmployee: vi.fn(),
  deactivateUser: vi.fn(),
  setEmployeePin: vi.fn(),
  deleteAuthAccount: vi.fn(),
  getUserClaims: vi.fn(),
  insertEmployeeJob: vi.fn(),
  mergeInvitePermissions: vi.fn(() => ({})),
  serviceRoleWrites: [] as { table: string; op: string; payload: unknown }[]
}));

// hasPermission stays real: the re-add path's permission check is under test.
// It is read from its source file because the package root pulls in Lingui
// macros that only run inside the app build.
vi.mock("@carbon/auth", async () => ({
  ...(await vi.importActual<object>("@carbon/auth")),
  CarbonEdition: "test",
  CONTROLLED_ENVIRONMENT: false,
  error: vi.fn(),
  success: vi.fn(),
  hasPermission: (
    await vi.importActual<
      typeof import("../../../../../packages/auth/src/services/users")
    >("../../../../../packages/auth/src/services/users")
  ).hasPermission
}));

vi.mock("@carbon/auth/auth.server", () => ({
  deleteAuthAccount: mocks.deleteAuthAccount
}));

vi.mock("@carbon/auth/auth-events.server", () => ({
  logPermissionChange: vi.fn()
}));

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        single: () =>
          Promise.resolve(
            table === "user"
              ? { data: { id: USER, email: EMAIL }, error: null }
              : { data: null, error: null }
          ),
        // The employee type and location ownership checks: both belong to
        // the company in every test here.
        maybeSingle: () =>
          Promise.resolve(
            table === "employeeType" || table === "location"
              ? { data: { id: table }, error: null }
              : { data: null, error: null }
          ),
        upsert: (payload: unknown) => {
          mocks.serviceRoleWrites.push({ table, op: "upsert", payload });
          return chain;
        }
      };
      return chain;
    },
    auth: {
      admin: { getUserById: () => Promise.resolve({ error: null }) }
    }
  })
}));

vi.mock("@carbon/auth/session.server", () => ({
  flash: vi.fn(),
  requireAuthSession: vi.fn()
}));

vi.mock("@carbon/auth/users.server", () => ({
  deactivateCustomer: vi.fn(),
  deactivateEmployee: mocks.deactivateEmployee,
  deactivateSupplier: vi.fn(),
  deactivateUser: mocks.deactivateUser,
  getUserClaims: mocks.getUserClaims
}));

vi.mock("@carbon/ee/console.server", () => ({
  generateConsolePin: () => "4321",
  setEmployeePin: mocks.setEmployeePin
}));

vi.mock("@carbon/kv", () => ({
  redis: { del: vi.fn(), get: vi.fn(), set: vi.fn() }
}));

vi.mock("@carbon/ee/sso.server", () => ({
  emailDomain: vi.fn(),
  getSsoConnection: vi.fn(),
  getSsoConnectionByDomain: vi.fn(),
  isSsoEnabled: () => false,
  mergeInvitePermissions: mocks.mergeInvitePermissions,
  seedSsoIdentityForUser: vi.fn(),
  uncoveredSsoDomainError: vi.fn()
}));

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  })
}));

vi.mock("~/modules/purchasing/purchasing.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSupplierContact: vi.fn()
}));
vi.mock("~/modules/sales/sales.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCustomerContact: vi.fn()
}));
vi.mock("~/utils/path", () => ({ path: { to: {} } }));
vi.mock("../people/people.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  insertEmployeeJob: mocks.insertEmployeeJob
}));

const { certifyItarEntity, deactivateUsers, resetConsoleOperatorPin } =
  await import("./users.server");
const { acceptInvite, createEmployeeAccount } = await import("./users.service");
const { createServiceContext } = await import("@carbon/api/service-fn.server");

const USER = "usr_1";
const COMPANY = "cmp_1";
const EMAIL = "person@example.com";
const NEW_TYPE = "et_new";

const ACCOUNT = {
  email: EMAIL,
  firstName: "Pat",
  lastName: "Doe",
  employeeType: NEW_TYPE,
  locationId: "loc_1",
  companyId: COMPANY,
  createdBy: "usr_admin"
};

type Statement = { sql: string; parameters: readonly unknown[] };

/**
 * Drives Kysely's real Postgres compiler through a fake driver, so the tests
 * see the SQL the transaction would send and whether it committed or rolled
 * back. `respond` answers each statement, or throws to simulate a failed write.
 * Nothing reaches a database: a rollback here proves Kysely issued one and
 * stopped executing, not what Postgres did with it.
 */
function makeDb(respond: (statement: Statement) => unknown[]) {
  const statements: Statement[] = [];
  const transactions = { begin: 0, commit: 0, rollback: 0 };
  const connection: DatabaseConnection = {
    async executeQuery(query: CompiledQuery) {
      const statement = { sql: query.sql, parameters: query.parameters };
      statements.push(statement);
      return { rows: respond(statement) } as never;
    },
    async *streamQuery() {}
  };
  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      return connection;
    },
    async beginTransaction() {
      transactions.begin++;
    },
    async commitTransaction() {
      transactions.commit++;
    },
    async rollbackTransaction() {
      transactions.rollback++;
    },
    async releaseConnection() {},
    async destroy() {}
  };
  const db = new Kysely<Record<string, never>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });
  return { db, statements, transactions };
}

/** The caller's RLS client: answers the pre-read and records inserts. */
function makeClient(
  existingEmployee: { id: string; active: boolean } | null,
  readError: { message: string } | null = null
) {
  const writes: { table: string; op: string; payload: unknown }[] = [];
  const permissionReads: string[] = [];
  const client = {
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        // An employee type's permissions: the one read that ends at `.eq`.
        eq: (_column: string, value: string) => {
          if (table !== "employeeTypePermission") return chain;
          permissionReads.push(value);
          return Promise.resolve({
            data: EMPLOYEE_TYPE_PERMISSIONS,
            error: null
          });
        },
        maybeSingle: () =>
          Promise.resolve(
            readError
              ? { data: null, error: readError }
              : { data: existingEmployee, error: null }
          ),
        single: () => Promise.resolve({ data: {}, error: null }),
        insert: (payload: unknown) => {
          writes.push({ table, op: "insert", payload });
          return chain;
        }
      };
      return chain;
    }
  };
  return { client: client as never, writes, permissionReads };
}

const deactivated = { id: USER, active: false };

function answer(lockedRow: { active: boolean } | null) {
  return ({ sql }: Statement) =>
    sql.startsWith('select "active" from "employee"') && lockedRow
      ? [lockedRow]
      : [];
}

const EMPLOYEE_TYPE_PERMISSIONS = [
  {
    module: "Sales",
    view: [COMPANY],
    create: [COMPANY],
    update: [],
    delete: []
  }
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.serviceRoleWrites.length = 0;
  mocks.insertEmployeeJob.mockResolvedValue({ data: {}, error: null });
  // The inviter may do everything a first-time add needs.
  mocks.getUserClaims.mockResolvedValue({
    role: "employee",
    permissions: {
      users: { view: [], create: [COMPANY], update: [COMPANY], delete: [] },
      people: { view: [], create: [COMPANY], update: [], delete: [] }
    }
  });
});

describe("createEmployeeAccount — re-adding a deactivated employee", () => {
  it("writes the employee type, placement and invite in one committed transaction", async () => {
    const { db, statements, transactions } = makeDb(answer(deactivated));
    const { client, writes, permissionReads } = makeClient(deactivated);

    const result = await createEmployeeAccount(client, db as never, ACCOUNT);

    expect(result).toMatchObject({ success: true, userId: USER });
    if (!result.success) throw new Error(result.message);
    expect(transactions).toEqual({ begin: 1, commit: 1, rollback: 0 });

    const [lock, employee, job, invite] = statements;
    expect(statements).toHaveLength(4);
    expect(lock.sql).toMatch(/from "employee" .* for update$/);
    expect(lock.parameters).toEqual([USER, COMPANY]);
    expect(employee.sql).toMatch(/^update "employee" set "employeeTypeId" =/);
    expect(employee.parameters).toEqual([NEW_TYPE, USER, COMPANY]);
    expect(job.sql).toMatch(
      /^insert into "employeeJob" .* on conflict \("id", "companyId"\) do update set "locationId" =/
    );
    expect(invite.sql).toMatch(
      /^insert into "invite" .* on conflict \("email", "companyId"\) do update set/
    );
    expect(invite.sql).toMatch(/"acceptedAt" = \$\d+, "revokedAt" = \$\d+$/);

    // The invite carries the permissions of the SAME type written to the
    // employee row, under the code returned to the caller.
    const permissions = JSON.parse(invite.parameters[1] as string);
    expect(permissions).toEqual({
      sales_view: [COMPANY],
      sales_create: [COMPANY],
      sales_update: [],
      sales_delete: []
    });
    expect(invite.parameters).toContain(result.code);
    expect(permissionReads).toEqual([NEW_TYPE]);

    // Nothing went through the non-transactional clients.
    expect(writes).toEqual([]);
    expect(mocks.serviceRoleWrites).toEqual([]);
    expect(mocks.insertEmployeeJob).not.toHaveBeenCalled();
  });

  it("rolls back and writes nothing further when the employee write fails", async () => {
    const { db, statements, transactions } = makeDb((statement) => {
      if (statement.sql.startsWith('update "employee"')) {
        throw new Error("employee write failed");
      }
      return answer(deactivated)(statement);
    });
    const { client } = makeClient(deactivated);

    const result = await createEmployeeAccount(client, db as never, ACCOUNT);

    expect(result).toEqual({
      success: false,
      message: "employee write failed"
    });
    expect(transactions).toEqual({ begin: 1, commit: 0, rollback: 1 });
    // No placement or invite statement ran after the failure, so no
    // redeemable invite can outlive it.
    expect(statements.map((s) => s.sql.split(" ")[0])).toEqual([
      "select",
      "update"
    ]);
    expect(mocks.serviceRoleWrites).toEqual([]);
    // A rollback needs no compensation, and deactivating here would strip
    // whatever this person still holds in the company.
    expect(mocks.deactivateEmployee).not.toHaveBeenCalled();
    expect(mocks.deleteAuthAccount).not.toHaveBeenCalled();
  });

  it("rolls back the employee and placement writes when the invite write fails", async () => {
    const { db, statements, transactions } = makeDb((statement) => {
      if (statement.sql.startsWith('insert into "invite"')) {
        throw new Error("invite write failed");
      }
      return answer(deactivated)(statement);
    });
    const { client } = makeClient(deactivated);

    const result = await createEmployeeAccount(client, db as never, ACCOUNT);

    expect(result).toEqual({ success: false, message: "invite write failed" });
    expect(statements).toHaveLength(4);
    expect(transactions).toEqual({ begin: 1, commit: 0, rollback: 1 });
    expect(mocks.deactivateEmployee).not.toHaveBeenCalled();
    expect(mocks.deleteAuthAccount).not.toHaveBeenCalled();
  });

  it("refuses under the lock when the employee was activated since the pre-read", async () => {
    const { db, statements, transactions } = makeDb(answer({ active: true }));
    const { client } = makeClient(deactivated);

    const result = await createEmployeeAccount(client, db as never, ACCOUNT);

    expect(result).toEqual({
      success: false,
      message: "This user is already an employee in this company"
    });
    expect(statements).toHaveLength(1);
    expect(transactions).toEqual({ begin: 1, commit: 0, rollback: 1 });
  });

  it("refuses rather than inserting when the row disappeared since the pre-read", async () => {
    const { db, statements, transactions } = makeDb(answer(null));
    const { client } = makeClient(deactivated);

    const result = await createEmployeeAccount(client, db as never, ACCOUNT);

    expect(result.success).toBe(false);
    // Only the lock ran: a first-time employee insert never happens outside
    // the caller's RLS client.
    expect(statements).toHaveLength(1);
    expect(transactions.rollback).toBe(1);
  });
});

describe("createEmployeeAccount — re-add guards", () => {
  it("restarts the reused invite's createdAt, which the controlled-environment expiry counts from", async () => {
    const { db, statements } = makeDb(answer(deactivated));
    const { client } = makeClient(deactivated);

    const result = await createEmployeeAccount(client, db as never, ACCOUNT);

    expect(result.success).toBe(true);
    const invite = statements.find((s) =>
      s.sql.startsWith('insert into "invite"')
    );
    const onConflict = invite?.sql.split(" do update set ")[1] ?? "";
    // The reused row is the original invite, usually long since accepted.
    expect(onConflict).toMatch(/"createdAt" = \$\d+/);
    expect(onConflict).toMatch(/"updatedBy" = \$\d+/);
  });

  it("refuses an inviter who could not add the person the first time", async () => {
    // users_create only: a first-time add's RLS inserts need users_update and
    // people_create, so the RLS-bypassing re-add must not succeed either.
    mocks.getUserClaims.mockResolvedValue({
      role: "employee",
      permissions: {
        users: { view: [], create: [COMPANY], update: [], delete: [] },
        people: { view: [], create: [COMPANY], update: [], delete: [] }
      }
    });
    const { db, transactions } = makeDb(answer(deactivated));
    const { client, writes } = makeClient(deactivated);

    const result = await createEmployeeAccount(client, db as never, ACCOUNT);

    expect(result).toEqual({
      success: false,
      message:
        "Re-adding a deactivated employee requires the Users update and People create permissions"
    });
    expect(mocks.getUserClaims).toHaveBeenCalledWith(
      ACCOUNT.createdBy,
      COMPANY
    );
    expect(transactions.begin).toBe(0);
    expect(writes).toEqual([]);
    expect(mocks.serviceRoleWrites).toEqual([]);
  });
});

describe("createEmployeeAccount — the existing-employee read fails", () => {
  it("returns the error before any write path starts", async () => {
    const { db, transactions } = makeDb(() => []);
    const { client, writes } = makeClient(null, { message: "read failed" });

    const result = await createEmployeeAccount(client, db as never, ACCOUNT);

    expect(result).toEqual({ success: false, message: "read failed" });
    // Neither the re-invite transaction nor the first-time writes ran, so no
    // redeemable invite was written beside a failed employee insert.
    expect(transactions.begin).toBe(0);
    expect(writes).toEqual([]);
    expect(mocks.serviceRoleWrites).toEqual([]);
    expect(mocks.insertEmployeeJob).not.toHaveBeenCalled();
  });
});

describe("createEmployeeAccount — first time in the company", () => {
  it("keeps writing through the caller's RLS client, outside any transaction", async () => {
    const { db, transactions } = makeDb(() => []);
    const { client, writes } = makeClient(null);

    const result = await createEmployeeAccount(client, db as never, ACCOUNT);

    expect(result).toMatchObject({ success: true, userId: USER });
    expect(transactions.begin).toBe(0);
    expect(writes).toEqual([
      {
        table: "employee",
        op: "insert",
        payload: [
          {
            id: USER,
            employeeTypeId: NEW_TYPE,
            active: false,
            companyId: COMPANY
          }
        ]
      }
    ]);
    expect(mocks.insertEmployeeJob).toHaveBeenCalledWith(client, {
      id: USER,
      companyId: COMPANY,
      locationId: "loc_1"
    });
    expect(mocks.serviceRoleWrites).toMatchObject([
      { table: "invite", op: "upsert" }
    ]);
  });
});

describe("acceptInvite", () => {
  const INVITE = {
    id: "inv_1",
    code: "code_1",
    email: EMAIL,
    companyId: COMPANY,
    role: "employee",
    permissions: {},
    createdAt: "2026-10-01T00:00:00Z",
    acceptedAt: null,
    revokedAt: null
  };

  /** The service-role client acceptInvite looks the invite up with. */
  function makeInviteLookup() {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      single: () => Promise.resolve({ data: INVITE, error: null })
    };
    return { from: () => chain } as never;
  }

  /** `acceptedRow` is what the guarded invite update returns: none = lost. */
  function answerAccept(acceptedRow: typeof INVITE | null) {
    return ({ sql }: Statement) => {
      if (sql.startsWith('select "id", "employeeTypeId" from "employee"')) {
        return [{ id: USER, employeeTypeId: "et_1" }];
      }
      if (sql.startsWith('select "id" from "user"')) return [{ id: USER }];
      if (sql.startsWith('update "invite"')) {
        return acceptedRow ? [acceptedRow] : [];
      }
      return [];
    };
  }

  it("locks the user row before reading the permissions it merges into", async () => {
    const { db, statements, transactions } = makeDb(answerAccept(INVITE));

    const result = await acceptInvite(
      makeInviteLookup(),
      db as never,
      INVITE.code,
      EMAIL
    );

    expect(result.error).toBeNull();
    expect(transactions).toEqual({ begin: 1, commit: 1, rollback: 0 });
    const lock = statements.findIndex((s) =>
      /^select "id" from "user" where "id" = \$1 for no key update$/.test(s.sql)
    );
    const read = statements.findIndex((s) =>
      s.sql.startsWith('select "permissions" from "userPermission"')
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(statements[lock].parameters).toEqual([USER]);
    expect(lock).toBeLessThan(read);
  });

  it("does not accept an invite revoked after it was looked up", async () => {
    const { db, statements, transactions } = makeDb(answerAccept(null));

    const result = await acceptInvite(
      makeInviteLookup(),
      db as never,
      INVITE.code,
      EMAIL
    );

    expect(result).toEqual({
      data: null,
      error: {
        message: "This invite has already been accepted or was revoked."
      }
    });
    // The activation, membership and permission writes before the guard are
    // rolled back with it.
    expect(transactions).toEqual({ begin: 1, commit: 0, rollback: 1 });
    const update = statements.find((s) => s.sql.startsWith('update "invite"'));
    expect(update?.sql).toMatch(
      /"companyId" = \$\d+ and "acceptedAt" is null and "revokedAt" is null/
    );
  });
});

const unreachable = () => {
  throw new Error("must not be reached");
};

/** An operation's context for a user holding `permissions` in COMPANY. */
function operationContext(
  permissions: Record<string, Record<string, string[]>>,
  { user = null as Record<string, unknown> | null } = {}
) {
  const caller = {
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        single: async () =>
          user ? { data: user, error: null } : { data: null, error: {} }
      };
      return chain;
    }
  };
  return createServiceContext({
    actor: { type: "user", userId: "usr_admin", permissions },
    company: { id: COMPANY, groupId: "grp_1" },
    caller: caller as never,
    system: unreachable as never,
    pg: (() => ({})) as never,
    kv: unreachable as never
  });
}

describe("resetConsoleOperatorPin", () => {
  beforeEach(() => mocks.setEmployeePin.mockReset());

  const usersUpdate = { users: { update: [COMPANY] } };

  it("resets a console operator's PIN with users update alone", async () => {
    const result = await resetConsoleOperatorPin(
      operationContext(usersUpdate, {
        user: { id: USER, isConsoleOperator: true }
      }),
      { operatorId: USER }
    );
    expect(result.data).toEqual({ pin: "4321" });
    expect(mocks.setEmployeePin).toHaveBeenCalledOnce();
  });

  // A PIN pins in as that person anywhere on the floor: for anyone who is
  // not a console operator, it takes settings update too.
  it("refuses another person's PIN without settings update", async () => {
    const result = await resetConsoleOperatorPin(
      operationContext(usersUpdate, {
        user: { id: USER, isConsoleOperator: false }
      }),
      { operatorId: USER }
    );
    expect(result.error?.category).toBe("forbidden");
    expect(mocks.setEmployeePin).not.toHaveBeenCalled();
  });

  it("resets another person's PIN with settings update", async () => {
    const result = await resetConsoleOperatorPin(
      operationContext(
        { ...usersUpdate, settings: { update: [COMPANY] } },
        { user: { id: USER, isConsoleOperator: false } }
      ),
      { operatorId: USER }
    );
    expect(result.data).toEqual({ pin: "4321" });
  });
});

describe("deactivateUsers", () => {
  it("refuses the caller's own account", async () => {
    const result = await deactivateUsers(
      operationContext({ users: { delete: [COMPANY] } }),
      { userIds: [USER, "usr_admin"] }
    );
    expect(result.error?.category).toBe("rule");
    expect(mocks.deactivateUser).not.toHaveBeenCalled();
  });
});

describe("certifyItarEntity", () => {
  // An API key authenticates as the key, not a person: there is no signer.
  it("refuses an API key", async () => {
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
