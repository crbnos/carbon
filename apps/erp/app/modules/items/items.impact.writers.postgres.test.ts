import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPostgresClient,
  getPostgresConnectionPool,
  type Kysely,
  type KyselyDatabase
} from "@carbon/database/client";
import { PostgresDriver } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  ChangeNoticeImpactDecisionBulkMutationInput,
  ChangeNoticeImpactDecisionMutationInput,
  ChangeNoticeImpactSourceAccess
} from "./items.models";

vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

type ImpactWriterModule = typeof import("./items.service");

let writeChangeNoticeImpactDecision!: ImpactWriterModule["writeChangeNoticeImpactDecision"];
let writeChangeNoticeImpactDecisions!: ImpactWriterModule["writeChangeNoticeImpactDecisions"];

type PostgresPool = ReturnType<typeof getPostgresConnectionPool>;
type WriterDb = Kysely<KyselyDatabase>;
type PostgresConnection = Awaited<
  ReturnType<PostgresDriver["acquireConnection"]>
>;
type ExecuteQuery = PostgresConnection["executeQuery"];

type Fixture = {
  companyId: string;
  primaryUserId: string;
  concurrentUserIds: [string, string];
  noticeId: string;
  affectedItemId: string;
  itemId: string;
  jobIds: [string, string, string, string];
  unitOfMeasureCode: string;
  locationId: string;
};

type FixtureCleanup = {
  companyId?: string;
  userIds: string[];
  noticeId?: string;
  affectedItemId?: string;
  itemId?: string;
  jobIds: string[];
  unitOfMeasureCode?: string;
  locationId?: string;
  generatedCompanyTables: string[];
};

type ImpactState = {
  decisions: Array<{
    id: string;
    targetId: string;
    decisionStatus: string;
    noActionReasonCode: string | null;
    rationale: string | null;
    resolutionNote: string | null;
    assessmentSnapshot: unknown;
    revision: number;
    assessedBy: string;
  }>;
  provenance: Array<{
    id: string;
    decisionId: string;
    affectedItemId: string;
    affectedItemSourceId: string;
    open: boolean;
    endedReason: string | null;
  }>;
  history: Array<{
    id: string;
    decisionId: string;
    targetId: string;
    eventType: string;
    previousStatus: string | null;
    newStatus: string | null;
    previousReasonCode: string | null;
    newReasonCode: string | null;
    relatedAffectedItemId: string | null;
    priorAssessmentWasChanged: boolean;
    previousSnapshot: unknown;
    newSnapshot: unknown;
    createdBy: string;
  }>;
};

type DatabaseTarget = {
  database: string;
  host: string;
  port: string;
};

type DatabaseUrl = string | null;

const sourceAccess: ChangeNoticeImpactSourceAccess = {
  purchaseOrderLine: true,
  job: true,
  jobMaterial: true
};

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../../../../../");
const testDatabaseUrl = loadTestDatabaseUrl(repositoryRoot);
const previousDatabaseUrl = process.env.SUPABASE_DB_URL;

function loadTestDatabaseUrl(root: string): DatabaseUrl {
  const fromProcess = process.env.SUPABASE_DB_URL;
  const fromLocalFile = readEnvValue(
    resolve(root, ".env.local"),
    "SUPABASE_DB_URL"
  );
  const fromDotEnv = readEnvValue(resolve(root, ".env"), "SUPABASE_DB_URL");

  // The ordinary Vitest config uses this placeholder for server-module imports.
  // A PostgreSQL run must instead use the current worktree's local database.
  if (fromProcess && !isUnitTestDatabaseUrl(fromProcess)) return fromProcess;
  if (fromLocalFile && !isUnitTestDatabaseUrl(fromLocalFile))
    return fromLocalFile;
  if (fromDotEnv && !isUnitTestDatabaseUrl(fromDotEnv)) return fromDotEnv;
  return null;
}

function isUnitTestDatabaseUrl(value: string): boolean {
  return value.trim() === "postgresql://localhost";
}

function requireLocalDatabaseTarget(url: string): DatabaseTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "Change Notice Impact PostgreSQL harness setup failed: SUPABASE_DB_URL is malformed."
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  let database: string;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw new Error(
      "Change Notice Impact PostgreSQL harness setup failed: SUPABASE_DB_URL is malformed."
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !isLocalHost ||
    database !== "postgres" ||
    !parsed.username
  ) {
    throw new Error(
      "Change Notice Impact PostgreSQL harness setup failed: SUPABASE_DB_URL must identify the isolated local Carbon PostgreSQL database."
    );
  }

  return {
    database,
    host:
      hostname === "127.0.0.1" || hostname === "::1" ? "loopback" : hostname,
    port: parsed.port || "5432"
  };
}

function assertSameDatabaseTarget(
  configured: DatabaseTarget,
  repository: DatabaseTarget
): void {
  if (
    configured.database !== repository.database ||
    configured.host !== repository.host ||
    configured.port !== repository.port
  ) {
    throw new Error(
      "Change Notice Impact PostgreSQL harness setup failed: SUPABASE_DB_URL does not match the current worktree's .env.local database target."
    );
  }
}

function readEnvValue(path: string, key: string): string | null {
  try {
    const line = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .find((candidate) => candidate.trimStart().startsWith(`${key}=`));
    if (!line) return null;
    const value = line.slice(line.indexOf("=") + 1).trim();
    if (value.length < 2) return value || null;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
    return value;
  } catch {
    return null;
  }
}

function makeCleanupState(): FixtureCleanup {
  return {
    userIds: [],
    jobIds: [],
    generatedCompanyTables: []
  };
}

function assertExactlyOneRow(
  result: { rowCount: number | null; rows: unknown[] },
  label: string
): void {
  if (result.rowCount !== 1 || result.rows.length !== 1) {
    throw new Error(`Expected exactly one ${label} fixture row`);
  }
}

async function createFixture(
  pool: PostgresPool,
  cleanupState: FixtureCleanup,
  prefix: string
): Promise<Fixture> {
  const primaryUserId = `${prefix}-primary`;
  const firstConcurrentUserId = `${prefix}-writer-a`;
  const secondConcurrentUserId = `${prefix}-writer-b`;
  const userIds = [
    primaryUserId,
    firstConcurrentUserId,
    secondConcurrentUserId
  ];

  for (const [index, userId] of userIds.entries()) {
    const userResult = await pool.query(
      `INSERT INTO "user" ("id", "email", "firstName", "lastName")
       VALUES ($1, $2, $3, $4)
       RETURNING "id"`,
      [userId, `${userId}@example.test`, "Impact", `Writer ${index + 1}`]
    );
    assertExactlyOneRow(userResult, "user");
    cleanupState.userIds.push(userId);
  }

  const companyResult = await pool.query(
    `INSERT INTO "company" ("name", "baseCurrencyCode")
     VALUES ($1, 'USD')
     RETURNING "id"`,
    [`${prefix}-company`]
  );
  assertExactlyOneRow(companyResult, "company");
  const companyId = companyResult.rows[0].id as string;
  cleanupState.companyId = companyId;
  cleanupState.generatedCompanyTables.push(
    `searchIndex_${companyId}`,
    `auditLog_${companyId}`
  );

  const locationResult = await pool.query(
    `INSERT INTO "location"
       ("name", "addressLine1", "city", "postalCode", "timezone", "companyId", "createdBy")
     VALUES ($1, '1 Impact Way', 'Testville', '00000', 'UTC', $2, $3)
     RETURNING "id"`,
    [`${prefix}-location`, companyId, primaryUserId]
  );
  assertExactlyOneRow(locationResult, "location");
  const locationId = locationResult.rows[0].id as string;
  cleanupState.locationId = locationId;

  const unitOfMeasureCode = `U${randomBytes(3).toString("hex")}`.slice(0, 6);
  const unitOfMeasureResult = await pool.query(
    `INSERT INTO "unitOfMeasure" ("code", "name", "companyId", "createdBy")
     VALUES ($1, $2, $3, $4)
     RETURNING "code"`,
    [unitOfMeasureCode, `${prefix}-each`, companyId, primaryUserId]
  );
  assertExactlyOneRow(unitOfMeasureResult, "unit-of-measure");
  cleanupState.unitOfMeasureCode = unitOfMeasureCode;

  const itemResult = await pool.query(
    `INSERT INTO "item"
       ("readableId", "name", "type", "replenishmentSystem", "defaultMethodType",
        "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
     VALUES ($1, $2, 'Part', 'Make', 'Make to Order', 'Inventory', $3, $4, $5)
     RETURNING "id"`,
    [
      `${prefix}-part`,
      `${prefix} producing part`,
      unitOfMeasureCode,
      companyId,
      primaryUserId
    ]
  );
  assertExactlyOneRow(itemResult, "item");
  const itemId = itemResult.rows[0].id as string;
  cleanupState.itemId = itemId;

  const noticeResult = await pool.query(
    `INSERT INTO "changeOrder"
       ("changeOrderId", "name", "openDate", "companyId", "createdBy")
     VALUES ($1, $2, CURRENT_DATE, $3, $4)
     RETURNING "id"`,
    [
      `${prefix}-notice`,
      `${prefix} operational impact`,
      companyId,
      primaryUserId
    ]
  );
  assertExactlyOneRow(noticeResult, "Change Notice");
  const noticeId = noticeResult.rows[0].id as string;
  cleanupState.noticeId = noticeId;

  const affectedItemResult = await pool.query(
    `INSERT INTO "changeOrderAffectedItem"
       ("changeOrderId", "itemId", "companyId", "createdBy")
     VALUES ($1, $2, $3, $4)
     RETURNING "id"`,
    [noticeId, itemId, companyId, primaryUserId]
  );
  assertExactlyOneRow(affectedItemResult, "affected item");
  const affectedItemId = affectedItemResult.rows[0].id as string;
  cleanupState.affectedItemId = affectedItemId;

  const jobIds: string[] = [];
  for (let index = 1; index <= 4; index += 1) {
    const jobResult = await pool.query(
      `INSERT INTO "job"
         ("jobId", "itemId", "unitOfMeasureCode", "locationId", "status",
          "quantity", "quantityComplete", "companyId", "createdBy")
       VALUES ($1, $2, $3, $4, 'Draft', 10, 2, $5, $6)
       RETURNING "id"`,
      [
        `${prefix}-job-${index}`,
        itemId,
        unitOfMeasureCode,
        locationId,
        companyId,
        primaryUserId
      ]
    );
    assertExactlyOneRow(jobResult, "job");
    const jobId = jobResult.rows[0].id as string;
    jobIds.push(jobId);
    cleanupState.jobIds.push(jobId);
  }

  if (jobIds.length !== 4) {
    throw new Error("Expected four Change Notice Impact job targets");
  }

  return {
    companyId,
    primaryUserId,
    concurrentUserIds: [firstConcurrentUserId, secondConcurrentUserId],
    noticeId,
    affectedItemId,
    itemId,
    jobIds: jobIds as Fixture["jobIds"],
    unitOfMeasureCode,
    locationId
  };
}

function makeDecisionInput(
  fixture: Fixture,
  targetId: string,
  overrides: Partial<ChangeNoticeImpactDecisionMutationInput> = {}
): ChangeNoticeImpactDecisionMutationInput {
  return {
    changeNoticeId: fixture.noticeId,
    targetType: "job",
    targetId,
    decisionStatus: "Action required",
    noActionReasonCode: null,
    rationale: "Manufacturing review is required for this change.",
    resolutionNote: null,
    companyId: fixture.companyId,
    userId: fixture.primaryUserId,
    sourceAccess,
    ...overrides
  };
}

function makeBulkInput(
  fixture: Fixture,
  targetIds: string[]
): ChangeNoticeImpactDecisionBulkMutationInput {
  return {
    changeNoticeId: fixture.noticeId,
    companyId: fixture.companyId,
    userId: fixture.primaryUserId,
    sourceAccess,
    targets: targetIds.map((targetId) => ({
      targetType: "job",
      targetId,
      decisionStatus: "Action required",
      noActionReasonCode: null,
      rationale: `Bulk manufacturing review is required for ${targetId}.`,
      resolutionNote: null
    }))
  };
}

async function readImpactState(fixture: Fixture): Promise<ImpactState> {
  const pool = requirePool();
  const [decisions, provenance, history] = await Promise.all([
    pool.query(
      `SELECT "id", "targetId", "decisionStatus", "noActionReasonCode", "rationale",
              "resolutionNote", "assessmentSnapshot", "revision", "assessedBy"
       FROM "changeOrderImpactDecision"
       WHERE "companyId" = $1 AND "changeNoticeId" = $2
       ORDER BY "targetId", "id"`,
      [fixture.companyId, fixture.noticeId]
    ),
    pool.query(
      `SELECT "id", "decisionId", "affectedItemId", "affectedItemSourceId",
              ("endedAt" IS NULL) AS "open", "endedReason"
       FROM "changeOrderImpactDecisionAffectedItem"
       WHERE "companyId" = $1
       ORDER BY "decisionId", "startedAt", "id"`,
      [fixture.companyId]
    ),
    pool.query(
      `SELECT "id", "decisionId", "targetId", "eventType", "previousStatus", "newStatus",
              "previousReasonCode", "newReasonCode", "relatedAffectedItemId",
              "priorAssessmentWasChanged", "previousSnapshot", "newSnapshot", "createdBy"
       FROM "changeOrderImpactDecisionHistory"
       WHERE "companyId" = $1
       ORDER BY "decisionId", "createdAt", "id"`,
      [fixture.companyId]
    )
  ]);

  return {
    decisions: decisions.rows.map((row) => ({
      id: String(row.id),
      targetId: String(row.targetId),
      decisionStatus: String(row.decisionStatus),
      noActionReasonCode: row.noActionReasonCode,
      rationale: row.rationale,
      resolutionNote: row.resolutionNote,
      assessmentSnapshot: row.assessmentSnapshot,
      revision: Number(row.revision),
      assessedBy: String(row.assessedBy)
    })),
    provenance: provenance.rows.map((row) => ({
      id: String(row.id),
      decisionId: String(row.decisionId),
      affectedItemId: String(row.affectedItemId),
      affectedItemSourceId: String(row.affectedItemSourceId),
      open: Boolean(row.open),
      endedReason: row.endedReason
    })),
    history: history.rows.map((row) => ({
      id: String(row.id),
      decisionId: String(row.decisionId),
      targetId: String(row.targetId),
      eventType: String(row.eventType),
      previousStatus: row.previousStatus,
      newStatus: row.newStatus,
      previousReasonCode: row.previousReasonCode,
      newReasonCode: row.newReasonCode,
      relatedAffectedItemId: row.relatedAffectedItemId,
      priorAssessmentWasChanged: Boolean(row.priorAssessmentWasChanged),
      previousSnapshot: row.previousSnapshot,
      newSnapshot: row.newSnapshot,
      createdBy: String(row.createdBy)
    }))
  };
}

function requirePool(): PostgresPool {
  if (!databasePool)
    throw new Error("Real PostgreSQL pool was not initialized");
  return databasePool;
}

function requireFailurePool(): PostgresPool {
  if (!failurePool)
    throw new Error("Failure-injection PostgreSQL pool was not initialized");
  return failurePool;
}

function requireFixture(): Fixture {
  if (!fixture) throw new Error("Real PostgreSQL fixture was not initialized");
  return fixture;
}

class FailOnceAfterHistoryInsertDriver extends PostgresDriver {
  private failed = false;

  override async acquireConnection() {
    const connection = await super.acquireConnection();
    const executeQuery: ExecuteQuery = connection.executeQuery.bind(connection);
    connection.executeQuery = async <R>(
      compiledQuery: Parameters<ExecuteQuery>[0]
    ) => {
      const result = await executeQuery<R>(compiledQuery);
      if (
        !this.failed &&
        compiledQuery.sql
          .toLowerCase()
          .includes('into "changeorderimpactdecisionhistory"')
      ) {
        this.failed = true;
        throw new Error("Injected post-write failure");
      }
      return result;
    };
    return connection;
  }
}

function assertRowCount(
  result: { rowCount: number | null },
  expected: number,
  label: string
): void {
  if (result.rowCount !== expected) {
    throw new Error(
      `Expected ${expected} ${label} row(s), received ${result.rowCount ?? "null"}`
    );
  }
}

async function verifyNoResidue(
  pool: PostgresPool,
  cleanupState: FixtureCleanup
): Promise<void> {
  const failures: Array<{ label: string; error: unknown }> = [];
  const attempt = async (label: string, operation: () => Promise<void>) => {
    try {
      await operation();
    } catch (error) {
      failures.push({ label, error });
    }
  };
  const count = async (label: string, query: string, parameters: unknown[]) => {
    await attempt(`residue ${label}`, async () => {
      const result = await pool.query(query, parameters);
      const residueCount = Number(result.rows[0]?.count ?? 0);
      if (residueCount !== 0) {
        throw new Error(`${label} residue count was ${residueCount}`);
      }
      process.stdout.write(
        `Change Notice Impact PostgreSQL residue ${label}: 0\n`
      );
    });
  };

  if (cleanupState.companyId) {
    await count(
      "company",
      `SELECT count(*)::int AS "count" FROM "company" WHERE "id" = $1`,
      [cleanupState.companyId]
    );
  }
  if (cleanupState.noticeId && cleanupState.companyId) {
    await count(
      "Change Notice",
      `SELECT count(*)::int AS "count"
       FROM "changeOrder"
       WHERE "id" = $1 AND "companyId" = $2`,
      [cleanupState.noticeId, cleanupState.companyId]
    );
    await count(
      "affected item",
      `SELECT count(*)::int AS "count"
       FROM "changeOrderAffectedItem"
       WHERE "id" = $1 AND "companyId" = $2`,
      [cleanupState.affectedItemId, cleanupState.companyId]
    );
    await count(
      "Impact decision",
      `SELECT count(*)::int AS "count"
       FROM "changeOrderImpactDecision"
       WHERE "companyId" = $1 AND "changeNoticeId" = $2`,
      [cleanupState.companyId, cleanupState.noticeId]
    );
    await count(
      "Impact provenance",
      `SELECT count(*)::int AS "count"
       FROM "changeOrderImpactDecisionAffectedItem"
       WHERE "companyId" = $1`,
      [cleanupState.companyId]
    );
    await count(
      "Impact history",
      `SELECT count(*)::int AS "count"
       FROM "changeOrderImpactDecisionHistory"
       WHERE "companyId" = $1`,
      [cleanupState.companyId]
    );
  }
  if (cleanupState.jobIds.length > 0 && cleanupState.companyId) {
    await count(
      "Job",
      `SELECT count(*)::int AS "count"
       FROM "job"
       WHERE "companyId" = $1 AND "id" = ANY($2::text[])`,
      [cleanupState.companyId, cleanupState.jobIds]
    );
    await count(
      "Job make-method children",
      `SELECT count(*)::int AS "count"
       FROM "jobMakeMethod"
       WHERE "companyId" = $1 AND "jobId" = ANY($2::text[])`,
      [cleanupState.companyId, cleanupState.jobIds]
    );
    await count(
      "Job material children",
      `SELECT count(*)::int AS "count"
       FROM "jobMaterial"
       WHERE "companyId" = $1 AND "jobId" = ANY($2::text[])`,
      [cleanupState.companyId, cleanupState.jobIds]
    );
    await count(
      "Job operation children",
      `SELECT count(*)::int AS "count"
       FROM "jobOperation"
       WHERE "companyId" = $1 AND "jobId" = ANY($2::text[])`,
      [cleanupState.companyId, cleanupState.jobIds]
    );
  }
  if (cleanupState.itemId && cleanupState.companyId) {
    await count(
      "Item",
      `SELECT count(*)::int AS "count"
       FROM "item"
       WHERE "id" = $1 AND "companyId" = $2`,
      [cleanupState.itemId, cleanupState.companyId]
    );
  }
  if (cleanupState.locationId && cleanupState.companyId) {
    await count(
      "location",
      `SELECT count(*)::int AS "count"
       FROM "location"
       WHERE "id" = $1 AND "companyId" = $2`,
      [cleanupState.locationId, cleanupState.companyId]
    );
  }
  if (cleanupState.unitOfMeasureCode && cleanupState.companyId) {
    await count(
      "unit of measure",
      `SELECT count(*)::int AS "count"
       FROM "unitOfMeasure"
       WHERE "code" = $1 AND "companyId" = $2`,
      [cleanupState.unitOfMeasureCode, cleanupState.companyId]
    );
  }
  if (cleanupState.userIds.length > 0) {
    await count(
      "user",
      `SELECT count(*)::int AS "count"
       FROM "user"
       WHERE "id" = ANY($1::text[])`,
      [cleanupState.userIds]
    );
  }
  for (const tableName of cleanupState.generatedCompanyTables) {
    await count(
      tableName,
      `SELECT count(*)::int AS "count"
       FROM pg_catalog.pg_class AS relation
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND relation.relname = $1`,
      [tableName]
    );
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures.map(({ error }) => error),
      failures.map(({ label }) => label).join("; ")
    );
  }
}

async function cleanupFixture(
  pool: PostgresPool,
  cleanupState: FixtureCleanup
): Promise<void> {
  const failures: Array<{ label: string; error: unknown }> = [];
  const attempt = async (label: string, operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      failures.push({ label, error });
    }
  };
  let noticeDeleted = false;

  if (cleanupState.noticeId && cleanupState.companyId) {
    await attempt("delete Change Notice fixture", async () => {
      const result = await pool.query(
        `DELETE FROM "changeOrder"
         WHERE "id" = $1 AND "companyId" = $2
         RETURNING "id"`,
        [cleanupState.noticeId, cleanupState.companyId]
      );
      assertRowCount(result, 1, "Change Notice deletion");
      noticeDeleted = true;
    });
  }
  // Normally the Change Notice cascade removes this child. Keep a fallback only
  // for a failed parent delete so partial setup can still be recovered.
  if (!noticeDeleted && cleanupState.affectedItemId && cleanupState.companyId) {
    await attempt("delete affected-item fixture", async () => {
      const result = await pool.query(
        `DELETE FROM "changeOrderAffectedItem"
         WHERE "id" = $1 AND "companyId" = $2
         RETURNING "id"`,
        [cleanupState.affectedItemId, cleanupState.companyId]
      );
      assertRowCount(result, 1, "affected-item deletion");
    });
  }
  if (cleanupState.jobIds.length > 0 && cleanupState.companyId) {
    await attempt("delete Job fixtures", async () => {
      const result = await pool.query(
        `DELETE FROM "job"
         WHERE "id" = ANY($1::text[]) AND "companyId" = $2
         RETURNING "id"`,
        [cleanupState.jobIds, cleanupState.companyId]
      );
      assertRowCount(result, cleanupState.jobIds.length, "Job deletion");
    });
  }
  if (cleanupState.itemId && cleanupState.companyId) {
    await attempt("delete item fixture", async () => {
      const result = await pool.query(
        `DELETE FROM "item"
         WHERE "id" = $1 AND "companyId" = $2
         RETURNING "id"`,
        [cleanupState.itemId, cleanupState.companyId]
      );
      assertRowCount(result, 1, "item deletion");
    });
  }
  if (cleanupState.locationId && cleanupState.companyId) {
    await attempt("delete location fixture", async () => {
      const result = await pool.query(
        `DELETE FROM "location"
         WHERE "id" = $1 AND "companyId" = $2
         RETURNING "id"`,
        [cleanupState.locationId, cleanupState.companyId]
      );
      assertRowCount(result, 1, "location deletion");
    });
  }
  if (cleanupState.unitOfMeasureCode && cleanupState.companyId) {
    await attempt("delete unit-of-measure fixture", async () => {
      const result = await pool.query(
        `DELETE FROM "unitOfMeasure"
         WHERE "code" = $1 AND "companyId" = $2
         RETURNING "code"`,
        [cleanupState.unitOfMeasureCode, cleanupState.companyId]
      );
      assertRowCount(result, 1, "unit-of-measure deletion");
    });
  }

  for (const tableName of cleanupState.generatedCompanyTables) {
    const quotedTableName = tableName.replaceAll('"', '""');
    await attempt(`drop generated company table ${tableName}`, async () => {
      await pool.query(
        `DROP TABLE IF EXISTS public."${quotedTableName}" CASCADE`
      );
    });
  }

  if (cleanupState.companyId) {
    await attempt("delete company fixture", async () => {
      const result = await pool.query(
        `DELETE FROM "company" WHERE "id" = $1 RETURNING "id"`,
        [cleanupState.companyId]
      );
      assertRowCount(result, 1, "company deletion");
    });
  }

  if (cleanupState.userIds.length > 0) {
    await attempt("delete user fixtures", async () => {
      const result = await pool.query(
        `DELETE FROM "user"
         WHERE "id" = ANY($1::text[])
         RETURNING "id"`,
        [cleanupState.userIds]
      );
      assertRowCount(result, cleanupState.userIds.length, "user deletion");
    });
  }

  await attempt("verify Change Notice Impact fixture residue", () =>
    verifyNoResidue(pool, cleanupState)
  );

  if (failures.length > 0) {
    throw new AggregateError(
      failures.map(({ error }) => error),
      failures.map(({ label }) => label).join("; ")
    );
  }
}

class ParentLockRendezvous {
  private readonly releasePromise: Promise<void>;
  private resolveRelease!: () => void;
  private rejectRelease!: (error: Error) => void;
  private readonly timeout: ReturnType<typeof setTimeout>;
  private arrivalCount = 0;
  private waitingCount = 0;
  maxConcurrentWaiters = 0;

  constructor(participantCount: number, timeoutMs: number) {
    this.releasePromise = new Promise<void>((resolve, reject) => {
      this.resolveRelease = resolve;
      this.rejectRelease = reject;
    });
    this.timeout = setTimeout(() => {
      this.rejectRelease(
        new Error(
          `Parent-lock rendezvous timed out after ${timeoutMs}ms with ${this.arrivalCount} of ${participantCount} writers`
        )
      );
    }, timeoutMs);
    this.participantCount = participantCount;
  }

  private readonly participantCount: number;

  get arrivals(): number {
    return this.arrivalCount;
  }

  get released(): boolean {
    return this.arrivalCount >= this.participantCount;
  }

  async arrive(): Promise<void> {
    this.arrivalCount += 1;
    this.waitingCount += 1;
    this.maxConcurrentWaiters = Math.max(
      this.maxConcurrentWaiters,
      this.waitingCount
    );
    if (this.arrivalCount === this.participantCount) {
      clearTimeout(this.timeout);
      this.resolveRelease();
    }
    try {
      await this.releasePromise;
    } finally {
      this.waitingCount -= 1;
    }
  }
}

function makeParentLockRendezvousDriver(rendezvous: ParentLockRendezvous) {
  return class ParentLockRendezvousDriver extends PostgresDriver {
    override async acquireConnection() {
      const connection = await super.acquireConnection();
      const executeQuery: ExecuteQuery =
        connection.executeQuery.bind(connection);
      let reachedParentLock = false;
      connection.executeQuery = async <R>(
        compiledQuery: Parameters<ExecuteQuery>[0]
      ) => {
        const sql = compiledQuery.sql.toLowerCase();
        if (
          !reachedParentLock &&
          sql.includes('from "changeorder"') &&
          sql.includes("for update")
        ) {
          reachedParentLock = true;
          await rendezvous.arrive();
        }
        return executeQuery<R>(compiledQuery);
      };
      return connection;
    }
  };
}

async function assertDatabaseConnection(
  pool: PostgresPool,
  target: DatabaseTarget
): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT current_database() AS "database",
              EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'changeOrder'
              ) AS "hasChangeNotice"`
    );
    const row = result.rows[0];
    if (row?.database !== target.database || row?.hasChangeNotice !== true) {
      throw new Error(
        "the target is not the current Carbon PostgreSQL database"
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "the target is not the current Carbon PostgreSQL database"
    ) {
      throw new Error(
        "Change Notice Impact PostgreSQL harness setup failed: the local database is not the Carbon schema for this worktree."
      );
    }
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "unknown";
    throw new Error(
      `Change Notice Impact PostgreSQL harness setup failed: the isolated local database could not be connected (code ${code}).`
    );
  }
}

let databasePool: PostgresPool | undefined;
let failurePool: PostgresPool | undefined;
let racePool: PostgresPool | undefined;
let writerDb: WriterDb | undefined;
let fixture: Fixture | undefined;
let cleanupState: FixtureCleanup | undefined;

describe("Change Notice Impact decision writers (real PostgreSQL)", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error(
        "Change Notice Impact PostgreSQL harness setup failed: SUPABASE_DB_URL is absent or still the unit-test placeholder."
      );
    }
    const configuredTarget = requireLocalDatabaseTarget(testDatabaseUrl);
    const repositoryDatabaseUrl = readEnvValue(
      resolve(repositoryRoot, ".env.local"),
      "SUPABASE_DB_URL"
    );
    if (!repositoryDatabaseUrl) {
      throw new Error(
        "Change Notice Impact PostgreSQL harness setup failed: the current worktree .env.local database target is unavailable."
      );
    }
    assertSameDatabaseTarget(
      configuredTarget,
      requireLocalDatabaseTarget(repositoryDatabaseUrl)
    );

    process.env.SUPABASE_DB_URL = testDatabaseUrl;
    databasePool = getPostgresConnectionPool(4);
    await assertDatabaseConnection(databasePool, configuredTarget);

    const writerModule = await import("./items.service");
    writeChangeNoticeImpactDecision =
      writerModule.writeChangeNoticeImpactDecision;
    writeChangeNoticeImpactDecisions =
      writerModule.writeChangeNoticeImpactDecisions;
    writerDb = getPostgresClient(databasePool, PostgresDriver);
    failurePool = getPostgresConnectionPool(3);
    racePool = getPostgresConnectionPool(2);
    cleanupState = makeCleanupState();
    fixture = await createFixture(
      databasePool,
      cleanupState,
      `impact-writers-${randomBytes(12).toString("hex")}`
    );
  });

  afterAll(async () => {
    const failures: unknown[] = [];
    try {
      if (databasePool && cleanupState) {
        await cleanupFixture(databasePool, cleanupState);
      }
    } catch (error) {
      failures.push(error);
    } finally {
      const pools = [databasePool, failurePool, racePool].filter(
        (pool): pool is PostgresPool => pool !== undefined
      );
      for (const pool of [...new Set(pools)]) {
        try {
          await pool.end();
        } catch (error) {
          failures.push(error);
        }
      }

      if (previousDatabaseUrl === undefined) {
        Reflect.deleteProperty(process.env, "SUPABASE_DB_URL");
      } else {
        process.env.SUPABASE_DB_URL = previousDatabaseUrl;
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Change Notice Impact PostgreSQL teardown failed"
      );
    }
  });

  it("maintains first-assessment idempotency, CAS rejection, bulk rollback, and two-writer CAS", async () => {
    const db = writerDb;
    const currentFixture = requireFixture();
    if (!db) throw new Error("Real PostgreSQL writer was not initialized");

    const initialState = await readImpactState(currentFixture);
    expect(initialState).toEqual({
      decisions: [],
      provenance: [],
      history: []
    });

    const firstAssessment = await writeChangeNoticeImpactDecision(
      db,
      makeDecisionInput(currentFixture, currentFixture.jobIds[0])
    );
    expect(firstAssessment).toMatchObject({
      error: null,
      data: {
        operation: "createDecision",
        decision: {
          targetType: "job",
          targetId: currentFixture.jobIds[0],
          decisionStatus: "Action required",
          revision: 1
        }
      }
    });
    const firstDecisionId = firstAssessment.data?.decision.id;
    expect(firstDecisionId).toEqual(expect.any(String));

    const afterFirstAssessment = await readImpactState(currentFixture);
    expect(afterFirstAssessment.decisions).toHaveLength(1);
    expect(afterFirstAssessment.decisions[0]).toMatchObject({
      id: firstDecisionId,
      targetId: currentFixture.jobIds[0],
      decisionStatus: "Action required",
      noActionReasonCode: null,
      rationale: "Manufacturing review is required for this change.",
      revision: 1,
      assessedBy: currentFixture.primaryUserId
    });
    expect(afterFirstAssessment.decisions[0].assessmentSnapshot).toMatchObject({
      schema: "JOB_SNAPSHOT_V1",
      jobId: currentFixture.jobIds[0],
      itemId: currentFixture.itemId,
      plannedQuantity: 10,
      completedQuantity: 2,
      remainingQuantity: 8,
      effectiveMethodVersion: 1,
      eligibilityBasis: "activeProducingJob"
    });
    expect(afterFirstAssessment.provenance).toEqual([
      {
        id: expect.any(String),
        decisionId: firstDecisionId,
        affectedItemId: currentFixture.affectedItemId,
        affectedItemSourceId: currentFixture.itemId,
        open: true,
        endedReason: null
      }
    ]);
    expect(afterFirstAssessment.history).toHaveLength(2);
    expect(afterFirstAssessment.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decisionId: firstDecisionId,
          targetId: currentFixture.jobIds[0],
          eventType: "Decision created",
          previousStatus: null,
          newStatus: "Action required",
          createdBy: currentFixture.primaryUserId
        }),
        expect.objectContaining({
          decisionId: firstDecisionId,
          targetId: currentFixture.jobIds[0],
          eventType: "Provenance started",
          relatedAffectedItemId: currentFixture.affectedItemId,
          createdBy: currentFixture.primaryUserId
        })
      ])
    );

    const idempotentAssessment = await writeChangeNoticeImpactDecision(
      db,
      makeDecisionInput(currentFixture, currentFixture.jobIds[0], {
        expectedRevision: 1
      })
    );
    expect(idempotentAssessment).toMatchObject({
      error: null,
      data: {
        operation: "noOp",
        decision: {
          id: firstDecisionId,
          targetId: currentFixture.jobIds[0],
          revision: 1
        }
      }
    });
    expect(await readImpactState(currentFixture)).toEqual(afterFirstAssessment);

    const sourceUpdate = await requirePool().query(
      `UPDATE "job"
         SET "quantityComplete" = 3
         WHERE "id" = $1 AND "companyId" = $2
         RETURNING "id", "quantityComplete"`,
      [currentFixture.jobIds[0], currentFixture.companyId]
    );
    assertExactlyOneRow(sourceUpdate, "source job update");
    expect(sourceUpdate.rows[0]).toMatchObject({
      id: currentFixture.jobIds[0],
      quantityComplete: 3
    });

    const beforeReassessment = await readImpactState(currentFixture);
    const reassessment = await writeChangeNoticeImpactDecision(
      db,
      makeDecisionInput(currentFixture, currentFixture.jobIds[0], {
        expectedRevision: 1
      })
    );
    expect(reassessment).toMatchObject({
      error: null,
      data: {
        operation: "updateDecision",
        decision: {
          id: firstDecisionId,
          targetId: currentFixture.jobIds[0],
          revision: 2,
          assessedBy: currentFixture.primaryUserId
        }
      }
    });

    const afterReassessment = await readImpactState(currentFixture);
    expect(afterReassessment.decisions).toHaveLength(1);
    expect(afterReassessment.decisions[0]).toMatchObject({
      id: firstDecisionId,
      revision: 2,
      assessedBy: currentFixture.primaryUserId,
      assessmentSnapshot: expect.objectContaining({
        completedQuantity: 3,
        remainingQuantity: 7
      })
    });
    expect(afterReassessment.provenance).toEqual(beforeReassessment.provenance);
    expect(afterReassessment.history).toHaveLength(
      beforeReassessment.history.length + 1
    );
    const beforeReassessmentHistoryIds = new Set(
      beforeReassessment.history.map((event) => event.id)
    );
    const reassessmentHistory = afterReassessment.history.filter(
      (event) => !beforeReassessmentHistoryIds.has(event.id)
    );
    expect(reassessmentHistory).toHaveLength(1);
    expect(reassessmentHistory[0]).toMatchObject({
      decisionId: firstDecisionId,
      targetId: currentFixture.jobIds[0],
      eventType: "Decision reassessed",
      previousStatus: "Action required",
      newStatus: "Action required",
      previousSnapshot: beforeReassessment.decisions[0].assessmentSnapshot,
      newSnapshot: afterReassessment.decisions[0].assessmentSnapshot,
      priorAssessmentWasChanged: true,
      createdBy: currentFixture.primaryUserId
    });

    const beforeStaleCas = afterReassessment;
    const staleCas = await writeChangeNoticeImpactDecision(
      db,
      makeDecisionInput(currentFixture, currentFixture.jobIds[0], {
        expectedRevision: 1,
        rationale: "A stale writer must not alter the assessment."
      })
    );
    expect(staleCas).toEqual({
      data: null,
      error: {
        message:
          "This Impact assessment changed before your update. Refresh and try again."
      }
    });
    expect(await readImpactState(currentFixture)).toEqual(beforeStaleCas);

    const bulkInput = makeBulkInput(currentFixture, [
      currentFixture.jobIds[1],
      currentFixture.jobIds[2]
    ]);
    const beforeBulkRollback = await readImpactState(currentFixture);
    const failingDb = getPostgresClient(
      requireFailurePool(),
      FailOnceAfterHistoryInsertDriver
    );
    const failedBulk = await writeChangeNoticeImpactDecisions(
      failingDb,
      bulkInput
    );
    expect(failedBulk.data).toBeNull();
    expect(failedBulk.error?.message).toContain("Injected post-write failure");
    expect(await readImpactState(currentFixture)).toEqual(beforeBulkRollback);

    const committedBulk = await writeChangeNoticeImpactDecisions(db, bulkInput);
    expect(committedBulk).toEqual({
      data: {
        changeNoticeId: currentFixture.noticeId,
        selectedCount: 2,
        appliedCount: 2,
        noOpCount: 0
      },
      error: null
    });
    const afterBulk = await readImpactState(currentFixture);
    expect(afterBulk.decisions).toHaveLength(3);
    expect(
      afterBulk.decisions
        .filter((decision) =>
          [currentFixture.jobIds[1], currentFixture.jobIds[2]].includes(
            decision.targetId
          )
        )
        .map((decision) => decision.revision)
    ).toEqual([1, 1]);
    expect(afterBulk.provenance).toHaveLength(3);
    expect(afterBulk.provenance.every((row) => row.open)).toBe(true);
    expect(afterBulk.history).toHaveLength(
      afterReassessment.history.length + bulkInput.targets.length * 2
    );

    const fourthTarget = currentFixture.jobIds[3];
    const seededRaceDecision = await writeChangeNoticeImpactDecision(
      db,
      makeDecisionInput(currentFixture, fourthTarget)
    );
    expect(seededRaceDecision).toMatchObject({
      error: null,
      data: { operation: "createDecision", decision: { revision: 1 } }
    });

    const beforeRace = await readImpactState(currentFixture);
    const raceInputs = currentFixture.concurrentUserIds.map((userId, index) =>
      makeDecisionInput(currentFixture, fourthTarget, {
        userId,
        expectedRevision: 1,
        decisionStatus: "No action required",
        noActionReasonCode: "Not affected after review",
        rationale: `Concurrent writer ${index + 1} corrected the conclusion.`
      })
    );
    const rendezvous = new ParentLockRendezvous(2, 3000);
    const RaceDriver = makeParentLockRendezvousDriver(rendezvous);
    if (!racePool) {
      throw new Error("Dedicated race pool was not initialized");
    }
    const raceDbs = [
      getPostgresClient(racePool, RaceDriver),
      getPostgresClient(racePool, RaceDriver)
    ] as const;
    // Start both transactions before awaiting either result. The driver-level
    // rendezvous releases only after both writers reach the parent lock query.
    const racePromises = raceInputs.map((input, index) =>
      writeChangeNoticeImpactDecision(raceDbs[index], input)
    );
    const raceResults = await Promise.all(racePromises);
    expect(rendezvous.arrivals).toBe(2);
    expect(rendezvous.released).toBe(true);
    expect(rendezvous.maxConcurrentWaiters).toBe(2);

    const successfulRaceResults = raceResults.filter(
      (result) => result.data !== null && result.error === null
    );
    const rejectedRaceResults = raceResults.filter(
      (result) =>
        result.data === null &&
        result.error?.message ===
          "This Impact assessment changed before your update. Refresh and try again."
    );
    expect(successfulRaceResults).toHaveLength(1);
    expect(rejectedRaceResults).toHaveLength(1);
    expect(successfulRaceResults[0]).toMatchObject({
      error: null,
      data: {
        operation: "correctDecision",
        decision: {
          targetId: fourthTarget,
          decisionStatus: "No action required",
          noActionReasonCode: "Not affected after review",
          revision: 2
        }
      }
    });

    const successfulRaceIndex = raceResults.findIndex(
      (result) => result.data !== null && result.error === null
    );
    const rejectedRaceIndex = raceResults.findIndex(
      (result) =>
        result.data === null &&
        result.error?.message ===
          "This Impact assessment changed before your update. Refresh and try again."
    );
    const successfulRaceResult = raceResults[successfulRaceIndex];
    const rejectedRaceInput = raceInputs[rejectedRaceIndex];
    if (!successfulRaceResult?.data || !rejectedRaceInput) {
      throw new Error(
        "Could not identify the successful and rejected race writers"
      );
    }
    expect(successfulRaceResult.data.decision.assessedBy).toBe(
      raceInputs[successfulRaceIndex]?.userId
    );

    const afterRace = await readImpactState(currentFixture);
    const raceDecision = afterRace.decisions.find(
      (decision) => decision.targetId === fourthTarget
    );
    expect(raceDecision).toMatchObject({
      targetId: fourthTarget,
      decisionStatus: "No action required",
      noActionReasonCode: "Not affected after review",
      rationale: raceInputs[successfulRaceIndex]?.rationale,
      revision: 2,
      assessedBy: raceInputs[successfulRaceIndex]?.userId
    });
    expect(afterRace.decisions).toHaveLength(beforeRace.decisions.length);
    expect(afterRace.provenance).toEqual(beforeRace.provenance);
    expect(afterRace.history).toHaveLength(beforeRace.history.length + 1);
    const beforeRaceHistoryIds = new Set(
      beforeRace.history.map((event) => event.id)
    );
    const raceHistory = afterRace.history.filter(
      (event) => !beforeRaceHistoryIds.has(event.id)
    );
    expect(raceHistory).toEqual([
      expect.objectContaining({
        decisionId: raceDecision?.id,
        targetId: fourthTarget,
        eventType: "Conclusion corrected",
        previousStatus: "Action required",
        newStatus: "No action required",
        newReasonCode: "Not affected after review",
        priorAssessmentWasChanged: false,
        createdBy: raceInputs[successfulRaceIndex]?.userId
      })
    ]);
    expect(
      afterRace.history.filter(
        (event) =>
          event.decisionId === raceDecision?.id &&
          event.createdBy === rejectedRaceInput.userId
      )
    ).toHaveLength(0);
  });
});
