import type { CompiledQuery, DatabaseConnection, Driver } from "kysely";
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler
} from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

// users.server pulls in auth, SSO, Redis and two module barrels at import
// time. Everything createEmployeeAccount does not exercise is stubbed; the
// parts it does are recorded so each test can assert on which writes ran and
// through which client.
const mocks = vi.hoisted(() => ({
  deactivateEmployee: vi.fn(),
  deleteAuthAccount: vi.fn(),
  getDatabaseClient: vi.fn(),
  getPermissionsByEmployeeType: vi.fn(),
  insertEmployeeJob: vi.fn(),
  serviceRoleWrites: [] as { table: string; op: string; payload: unknown }[]
}));

vi.mock("@carbon/auth", () => ({
  CONTROLLED_ENVIRONMENT: false,
  error: vi.fn(),
  success: vi.fn()
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
  getUserClaims: vi.fn()
}));

vi.mock("@carbon/kv", () => ({
  redis: { del: vi.fn(), get: vi.fn(), set: vi.fn() }
}));

vi.mock("@carbon/ee/sso.server", () => ({
  emailDomain: vi.fn(),
  getSsoConnection: vi.fn(),
  getSsoConnectionByDomain: vi.fn(),
  isSsoEnabled: () => false,
  mergeInvitePermissions: vi.fn(),
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

vi.mock("~/modules/purchasing", () => ({ getSupplierContact: vi.fn() }));
vi.mock("~/modules/sales", () => ({ getCustomerContact: vi.fn() }));
vi.mock("~/modules/users", () => ({
  getPermissionsByEmployeeType: mocks.getPermissionsByEmployeeType
}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: mocks.getDatabaseClient
}));
vi.mock("~/utils/path", () => ({ path: { to: {} } }));
vi.mock("../people/people.service", () => ({
  insertEmployeeJob: mocks.insertEmployeeJob
}));

const { createEmployeeAccount } = await import("./users.server");

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
function makeClient(existingEmployee: { id: string; active: boolean } | null) {
  const writes: { table: string; op: string; payload: unknown }[] = [];
  const client = {
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve({ data: existingEmployee, error: null }),
        single: () => Promise.resolve({ data: {}, error: null }),
        insert: (payload: unknown) => {
          writes.push({ table, op: "insert", payload });
          return chain;
        }
      };
      return chain;
    }
  };
  return { client: client as never, writes };
}

const deactivated = { id: USER, active: false };

function answer(lockedRow: { active: boolean } | null) {
  return ({ sql }: Statement) =>
    sql.startsWith('select "active" from "employee"') && lockedRow
      ? [lockedRow]
      : [];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.serviceRoleWrites.length = 0;
  mocks.getPermissionsByEmployeeType.mockResolvedValue({
    data: [
      {
        module: "Sales",
        view: [COMPANY],
        create: [COMPANY],
        update: [],
        delete: []
      }
    ],
    error: null
  });
  mocks.insertEmployeeJob.mockResolvedValue({ data: {}, error: null });
});

describe("createEmployeeAccount — re-adding a deactivated employee", () => {
  it("writes the employee type, placement and invite in one committed transaction", async () => {
    const { db, statements, transactions } = makeDb(answer(deactivated));
    mocks.getDatabaseClient.mockReturnValue(db);
    const { client, writes } = makeClient(deactivated);

    const result = await createEmployeeAccount(client, ACCOUNT);

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
    expect(mocks.getPermissionsByEmployeeType).toHaveBeenCalledWith(
      client,
      NEW_TYPE
    );

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
    mocks.getDatabaseClient.mockReturnValue(db);
    const { client } = makeClient(deactivated);

    const result = await createEmployeeAccount(client, ACCOUNT);

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
    mocks.getDatabaseClient.mockReturnValue(db);
    const { client } = makeClient(deactivated);

    const result = await createEmployeeAccount(client, ACCOUNT);

    expect(result).toEqual({ success: false, message: "invite write failed" });
    expect(statements).toHaveLength(4);
    expect(transactions).toEqual({ begin: 1, commit: 0, rollback: 1 });
    expect(mocks.deactivateEmployee).not.toHaveBeenCalled();
    expect(mocks.deleteAuthAccount).not.toHaveBeenCalled();
  });

  it("refuses under the lock when the employee was activated since the pre-read", async () => {
    const { db, statements, transactions } = makeDb(answer({ active: true }));
    mocks.getDatabaseClient.mockReturnValue(db);
    const { client } = makeClient(deactivated);

    const result = await createEmployeeAccount(client, ACCOUNT);

    expect(result).toEqual({
      success: false,
      message: "This user is already an employee in this company"
    });
    expect(statements).toHaveLength(1);
    expect(transactions).toEqual({ begin: 1, commit: 0, rollback: 1 });
  });

  it("refuses rather than inserting when the row disappeared since the pre-read", async () => {
    const { db, statements, transactions } = makeDb(answer(null));
    mocks.getDatabaseClient.mockReturnValue(db);
    const { client } = makeClient(deactivated);

    const result = await createEmployeeAccount(client, ACCOUNT);

    expect(result.success).toBe(false);
    // Only the lock ran: a first-time employee insert never happens outside
    // the caller's RLS client.
    expect(statements).toHaveLength(1);
    expect(transactions.rollback).toBe(1);
  });
});

describe("createEmployeeAccount — first time in the company", () => {
  it("keeps writing through the caller's RLS client, outside any transaction", async () => {
    const { db, transactions } = makeDb(() => []);
    mocks.getDatabaseClient.mockReturnValue(db);
    const { client, writes } = makeClient(null);

    const result = await createEmployeeAccount(client, ACCOUNT);

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
