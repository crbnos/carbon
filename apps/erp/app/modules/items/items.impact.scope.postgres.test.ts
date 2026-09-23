import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "@carbon/database";
import {
  getPostgresClient,
  getPostgresConnectionPool,
  type Kysely,
  type KyselyDatabase
} from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PostgresDriver } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
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

type ImpactModule = typeof import("./items.service");
type PostgresPool = ReturnType<typeof getPostgresConnectionPool>;
type WriterDb = Kysely<KyselyDatabase>;
type PostgresConnection = Awaited<
  ReturnType<PostgresDriver["acquireConnection"]>
>;
type ExecuteQuery = PostgresConnection["executeQuery"];

type FixtureOptions = {
  includeReplacementCause?: boolean;
  includeSecondaryTarget?: boolean;
};

type Fixture = {
  companyId: string;
  primaryUserId: string;
  secondaryUserId: string;
  noticeId: string;
  itemAId: string;
  itemBId: string | null;
  itemUnrelatedId: string;
  affectedItemAId: string;
  affectedItemBId: string | null;
  targetJobId: string;
  targetJobMakeMethodId: string;
  secondaryJobId: string | null;
  unrelatedJobId: string;
  jobIds: string[];
  itemIds: string[];
  affectedItemIds: string[];
  unitOfMeasureCode: string;
  locationId: string;
};

type FixtureCleanup = {
  companyId?: string;
  userIds: string[];
  noticeId?: string;
  affectedItemIds: string[];
  itemIds: string[];
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
    startedBy: string;
    endedBy: string | null;
    endedReason: string | null;
    startedAt: string;
    endedAt: string | null;
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
    rationale: string | null;
    resolutionNote: string | null;
    createdBy: string;
    createdAt: string;
  }>;
};

type SourceState = {
  jobs: Array<{
    id: string;
    itemId: string;
    quantityComplete: number;
  }>;
  roots: Array<{
    id: string;
    jobId: string;
    itemId: string;
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

let readerPool: PostgresPool | undefined;
let writerPool: PostgresPool | undefined;
let failurePool: PostgresPool | undefined;
let racePool: PostgresPool | undefined;
let writerDb: WriterDb | undefined;
let removeChangeNoticeAffectedItem: ImpactModule["removeChangeNoticeAffectedItem"];
let reconcileChangeNoticeImpactProvenance: ImpactModule["reconcileChangeNoticeImpactProvenance"];
let writeChangeNoticeImpactDecision: ImpactModule["writeChangeNoticeImpactDecision"];

function loadTestDatabaseUrl(root: string): DatabaseUrl {
  const fromProcess = process.env.SUPABASE_DB_URL;
  const fromLocalFile = readEnvValue(
    resolve(root, ".env.local"),
    "SUPABASE_DB_URL"
  );
  const fromDotEnv = readEnvValue(resolve(root, ".env"), "SUPABASE_DB_URL");

  if (fromProcess && !isUnitTestDatabaseUrl(fromProcess)) return fromProcess;
  if (fromLocalFile && !isUnitTestDatabaseUrl(fromLocalFile))
    return fromLocalFile;
  if (fromDotEnv && !isUnitTestDatabaseUrl(fromDotEnv)) return fromDotEnv;
  return null;
}

function isUnitTestDatabaseUrl(value: string): boolean {
  return value.trim() === "postgresql://localhost";
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

function requireLocalDatabaseTarget(url: string): DatabaseTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "Change Notice Impact scope PostgreSQL setup failed: SUPABASE_DB_URL is malformed."
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  let database: string;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw new Error(
      "Change Notice Impact scope PostgreSQL setup failed: SUPABASE_DB_URL is malformed."
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !isLocalHost ||
    database !== "postgres" ||
    !parsed.username
  ) {
    throw new Error(
      "Change Notice Impact scope PostgreSQL setup failed: SUPABASE_DB_URL must identify the isolated local Carbon PostgreSQL database."
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
      "Change Notice Impact scope PostgreSQL setup failed: SUPABASE_DB_URL does not match the current worktree's .env.local database target."
    );
  }
}

function makeCleanupState(): FixtureCleanup {
  return {
    userIds: [],
    affectedItemIds: [],
    itemIds: [],
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

async function createFixture(
  pool: PostgresPool,
  cleanup: FixtureCleanup,
  prefix: string,
  options: FixtureOptions = {}
): Promise<Fixture> {
  const includeSecondaryTarget = options.includeSecondaryTarget === true;
  const includeReplacementCause =
    options.includeReplacementCause === true || includeSecondaryTarget;
  const primaryUserId = `${prefix}-primary`;
  const secondaryUserId = `${prefix}-secondary`;
  const userIds = [primaryUserId, secondaryUserId];

  for (const [index, userId] of userIds.entries()) {
    const result = await pool.query(
      `INSERT INTO "user" ("id", "email", "firstName", "lastName")
       VALUES ($1, $2, $3, $4)
       RETURNING "id"`,
      [userId, `${userId}@example.test`, "Impact", `Scope ${index + 1}`]
    );
    assertExactlyOneRow(result, "user");
    cleanup.userIds.push(userId);
  }

  const companyResult = await pool.query(
    `INSERT INTO "company" ("name", "baseCurrencyCode")
     VALUES ($1, 'USD')
     RETURNING "id"`,
    [`${prefix}-company`]
  );
  assertExactlyOneRow(companyResult, "company");
  const companyId = String(companyResult.rows[0].id);
  cleanup.companyId = companyId;
  cleanup.generatedCompanyTables.push(
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
  const locationId = String(locationResult.rows[0].id);
  cleanup.locationId = locationId;

  const unitOfMeasureCode = `U${randomBytes(5).toString("hex")}`.slice(0, 8);
  const unitResult = await pool.query(
    `INSERT INTO "unitOfMeasure" ("code", "name", "companyId", "createdBy")
     VALUES ($1, $2, $3, $4)
     RETURNING "code"`,
    [unitOfMeasureCode, `${prefix}-each`, companyId, primaryUserId]
  );
  assertExactlyOneRow(unitResult, "unit-of-measure");
  cleanup.unitOfMeasureCode = unitOfMeasureCode;

  const itemAResult = await insertItem(
    pool,
    companyId,
    unitOfMeasureCode,
    primaryUserId,
    `${prefix}-part-a`,
    `${prefix} part A`
  );
  const itemAId = String(itemAResult);
  cleanup.itemIds.push(itemAId);

  const itemUnrelatedId = await insertItem(
    pool,
    companyId,
    unitOfMeasureCode,
    primaryUserId,
    `${prefix}-part-unrelated`,
    `${prefix} unrelated part`
  );
  cleanup.itemIds.push(itemUnrelatedId);

  const itemBId = includeReplacementCause
    ? await insertItem(
        pool,
        companyId,
        unitOfMeasureCode,
        primaryUserId,
        `${prefix}-part-b`,
        `${prefix} part B`
      )
    : null;
  if (itemBId) cleanup.itemIds.push(itemBId);

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
  const noticeId = String(noticeResult.rows[0].id);
  cleanup.noticeId = noticeId;

  const affectedItemAId = await insertAffectedItem(
    pool,
    noticeId,
    itemAId,
    companyId,
    primaryUserId
  );
  cleanup.affectedItemIds.push(affectedItemAId);

  const affectedItemBId = itemBId
    ? await insertAffectedItem(
        pool,
        noticeId,
        itemBId,
        companyId,
        primaryUserId
      )
    : null;
  if (affectedItemBId) cleanup.affectedItemIds.push(affectedItemBId);

  const targetJobId = await insertJob(
    pool,
    companyId,
    unitOfMeasureCode,
    locationId,
    itemAId,
    primaryUserId,
    `${prefix}-job-a`
  );
  cleanup.jobIds.push(targetJobId);

  const secondaryJobId =
    includeSecondaryTarget && itemBId
      ? await insertJob(
          pool,
          companyId,
          unitOfMeasureCode,
          locationId,
          itemBId,
          primaryUserId,
          `${prefix}-job-b`
        )
      : null;
  if (secondaryJobId) cleanup.jobIds.push(secondaryJobId);

  const unrelatedJobId = await insertJob(
    pool,
    companyId,
    unitOfMeasureCode,
    locationId,
    itemUnrelatedId,
    primaryUserId,
    `${prefix}-job-unrelated`
  );
  cleanup.jobIds.push(unrelatedJobId);

  const targetJobMakeMethodId = await findRootJobMakeMethod(
    pool,
    companyId,
    targetJobId
  );

  return {
    companyId,
    primaryUserId,
    secondaryUserId,
    noticeId,
    itemAId,
    itemBId,
    itemUnrelatedId,
    affectedItemAId,
    affectedItemBId,
    targetJobId,
    targetJobMakeMethodId,
    secondaryJobId,
    unrelatedJobId,
    jobIds: cleanup.jobIds.slice(),
    itemIds: cleanup.itemIds.slice(),
    affectedItemIds: cleanup.affectedItemIds.slice(),
    unitOfMeasureCode,
    locationId
  };
}

async function insertItem(
  pool: PostgresPool,
  companyId: string,
  unitOfMeasureCode: string,
  createdBy: string,
  readableId: string,
  name: string
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO "item"
       ("readableId", "name", "type", "replenishmentSystem", "defaultMethodType",
        "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
     VALUES ($1, $2, 'Part', 'Make', 'Make to Order', 'Inventory', $3, $4, $5)
     RETURNING "id"`,
    [readableId, name, unitOfMeasureCode, companyId, createdBy]
  );
  assertExactlyOneRow(result, "item");
  return String(result.rows[0].id);
}

async function insertAffectedItem(
  pool: PostgresPool,
  noticeId: string,
  itemId: string,
  companyId: string,
  createdBy: string
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO "changeOrderAffectedItem"
       ("changeOrderId", "itemId", "companyId", "createdBy")
     VALUES ($1, $2, $3, $4)
     RETURNING "id"`,
    [noticeId, itemId, companyId, createdBy]
  );
  assertExactlyOneRow(result, "affected item");
  return String(result.rows[0].id);
}

async function insertJob(
  pool: PostgresPool,
  companyId: string,
  unitOfMeasureCode: string,
  locationId: string,
  itemId: string,
  createdBy: string,
  readableId: string
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO "job"
       ("jobId", "itemId", "unitOfMeasureCode", "locationId", "status",
        "quantity", "quantityComplete", "companyId", "createdBy")
     VALUES ($1, $2, $3, $4, 'Draft', 10, 2, $5, $6)
     RETURNING "id"`,
    [readableId, itemId, unitOfMeasureCode, locationId, companyId, createdBy]
  );
  assertExactlyOneRow(result, "job");
  return String(result.rows[0].id);
}

async function findRootJobMakeMethod(
  pool: PostgresPool,
  companyId: string,
  jobId: string
): Promise<string> {
  const result = await pool.query(
    `SELECT "id"
     FROM "jobMakeMethod"
     WHERE "companyId" = $1 AND "jobId" = $2 AND "parentMaterialId" IS NULL
     ORDER BY "id"
     LIMIT 2`,
    [companyId, jobId]
  );
  assertExactlyOneRow(result, "root job make-method");
  return String(result.rows[0].id);
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

function makeReconciliationInput(fixture: Fixture) {
  return {
    companyId: fixture.companyId,
    userId: fixture.secondaryUserId,
    changeNoticeId: fixture.noticeId,
    sourceAccess
  };
}

function makeUnusedSupabaseClient(): SupabaseClient<Database> {
  return {
    from: () => {
      throw new Error("Unexpected Supabase draft cleanup access");
    }
  } as unknown as SupabaseClient<Database>;
}

async function readImpactState(fixture: Fixture): Promise<ImpactState> {
  const pool = requireReaderPool();
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
              ("endedAt" IS NULL) AS "open", "startedBy", "endedBy", "endedReason",
              "startedAt"::text AS "startedAt", "endedAt"::text AS "endedAt"
       FROM "changeOrderImpactDecisionAffectedItem" AS provenance
       WHERE "companyId" = $1
         AND EXISTS (
           SELECT 1
           FROM "changeOrderImpactDecision" AS decision
           WHERE decision."id" = provenance."decisionId"
             AND decision."companyId" = provenance."companyId"
             AND decision."changeNoticeId" = $2
         )
       ORDER BY "decisionId", "startedAt", "id"`,
      [fixture.companyId, fixture.noticeId]
    ),
    pool.query(
      `SELECT "id", "decisionId", "targetId", "eventType", "previousStatus", "newStatus",
              "previousReasonCode", "newReasonCode", "relatedAffectedItemId",
              "priorAssessmentWasChanged", "previousSnapshot", "newSnapshot",
              "rationale", "resolutionNote", "createdBy", "createdAt"::text AS "createdAt"
       FROM "changeOrderImpactDecisionHistory"
       WHERE "companyId" = $1
         AND EXISTS (
           SELECT 1
           FROM "changeOrderImpactDecision" AS decision
           WHERE decision."id" = "changeOrderImpactDecisionHistory"."decisionId"
             AND decision."companyId" = "changeOrderImpactDecisionHistory"."companyId"
             AND decision."changeNoticeId" = $2
         )
       ORDER BY "createdAt", "id"`,
      [fixture.companyId, fixture.noticeId]
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
      startedBy: String(row.startedBy),
      endedBy: row.endedBy === null ? null : String(row.endedBy),
      endedReason: row.endedReason,
      startedAt: String(row.startedAt),
      endedAt: row.endedAt === null ? null : String(row.endedAt)
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
      relatedAffectedItemId:
        row.relatedAffectedItemId === null
          ? null
          : String(row.relatedAffectedItemId),
      priorAssessmentWasChanged: Boolean(row.priorAssessmentWasChanged),
      previousSnapshot: row.previousSnapshot,
      newSnapshot: row.newSnapshot,
      rationale: row.rationale,
      resolutionNote: row.resolutionNote,
      createdBy: String(row.createdBy),
      createdAt: String(row.createdAt)
    }))
  };
}

async function readSourceState(fixture: Fixture): Promise<SourceState> {
  const pool = requireReaderPool();
  const [jobs, roots] = await Promise.all([
    pool.query(
      `SELECT "id", "itemId", "quantityComplete"
       FROM "job"
       WHERE "companyId" = $1 AND "id" = ANY($2::text[])
       ORDER BY "id"`,
      [fixture.companyId, fixture.jobIds]
    ),
    pool.query(
      `SELECT "id", "jobId", "itemId"
       FROM "jobMakeMethod"
       WHERE "companyId" = $1 AND "jobId" = ANY($2::text[])
         AND "parentMaterialId" IS NULL
       ORDER BY "jobId", "id"`,
      [fixture.companyId, fixture.jobIds]
    )
  ]);

  return {
    jobs: jobs.rows.map((row) => ({
      id: String(row.id),
      itemId: String(row.itemId),
      quantityComplete: Number(row.quantityComplete)
    })),
    roots: roots.rows.map((row) => ({
      id: String(row.id),
      jobId: String(row.jobId),
      itemId: String(row.itemId)
    }))
  };
}

async function readAffectedItemCount(
  fixture: Fixture,
  affectedItemId: string
): Promise<number> {
  const result = await requireReaderPool().query(
    `SELECT count(*)::int AS "count"
     FROM "changeOrderAffectedItem"
     WHERE "id" = $1 AND "changeOrderId" = $2 AND "companyId" = $3`,
    [affectedItemId, fixture.noticeId, fixture.companyId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function updateJobQuantityComplete(
  fixture: Fixture,
  quantityComplete: number
): Promise<void> {
  const result = await requireReaderPool().query(
    `UPDATE "job"
     SET "quantityComplete" = $1
     WHERE "id" = $2 AND "companyId" = $3
     RETURNING "id"`,
    [quantityComplete, fixture.targetJobId, fixture.companyId]
  );
  assertRowCount(result, 1, "source job quantity update");
}

async function replaceJobSourceItem(
  fixture: Fixture,
  itemId: string
): Promise<void> {
  const pool = requireReaderPool();
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    const jobResult = await connection.query(
      `UPDATE "job"
       SET "itemId" = $1
       WHERE "id" = $2 AND "companyId" = $3
       RETURNING "id"`,
      [itemId, fixture.targetJobId, fixture.companyId]
    );
    assertRowCount(jobResult, 1, "source job update");
    const rootResult = await connection.query(
      `UPDATE "jobMakeMethod"
       SET "itemId" = $1
       WHERE "id" = $2 AND "jobId" = $3 AND "companyId" = $4
       RETURNING "id"`,
      [
        itemId,
        fixture.targetJobMakeMethodId,
        fixture.targetJobId,
        fixture.companyId
      ]
    );
    assertRowCount(rootResult, 1, "source job make-method update");
    await connection.query("COMMIT");
  } catch (error) {
    try {
      await connection.query("ROLLBACK");
    } catch {
      // Preserve the source-change error; teardown will still verify residue.
    }
    throw error;
  } finally {
    connection.release();
  }
}

function requireReaderPool(): PostgresPool {
  if (!readerPool)
    throw new Error("Real PostgreSQL reader pool was not initialized");
  return readerPool;
}

function requireWriterDb(): WriterDb {
  if (!writerDb) throw new Error("Real PostgreSQL writer was not initialized");
  return writerDb;
}

function requireFailurePool(): PostgresPool {
  if (!failurePool)
    throw new Error("Failure-injection PostgreSQL pool was not initialized");
  return failurePool;
}

function makeFailOnceDriver(
  matcher: (sql: string) => boolean,
  message: string
): { driver: typeof PostgresDriver; didMatch: () => boolean } {
  let matched = false;
  let failed = false;

  class FailOnceDriver extends PostgresDriver {
    override async acquireConnection() {
      const connection = await super.acquireConnection();
      const executeQuery: ExecuteQuery =
        connection.executeQuery.bind(connection);
      connection.executeQuery = async <R>(
        compiledQuery: Parameters<ExecuteQuery>[0]
      ) => {
        const result = await executeQuery<R>(compiledQuery);
        const sql = compiledQuery.sql.replace(/\s+/g, " ").trim().toLowerCase();
        if (!failed && matcher(sql)) {
          matched = true;
          failed = true;
          throw new Error(message);
        }
        return result;
      };
      return connection;
    }
  }

  return { driver: FailOnceDriver, didMatch: () => matched };
}

class ParentLockRendezvous {
  private readonly participantCount: number;
  private readonly releasePromise: Promise<void>;
  private resolveRelease!: () => void;
  private rejectRelease!: (error: Error) => void;
  private readonly timeout: ReturnType<typeof setTimeout>;
  private arrivalCount = 0;
  private waitingCount = 0;
  maxConcurrentWaiters = 0;

  constructor(participantCount: number, timeoutMs: number) {
    this.participantCount = participantCount;
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
  }

  get arrivals(): number {
    return this.arrivalCount;
  }

  get released(): boolean {
    return this.arrivalCount === this.participantCount;
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
              count(*) FILTER (
                WHERE relation.relname = ANY($1::text[])
              )::int AS "tableCount"
       FROM pg_catalog.pg_class AS relation
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND relation.relkind IN ('r', 'p', 'v', 'm')`,
      [
        [
          "changeOrder",
          "changeOrderAffectedItem",
          "changeOrderImpactDecision",
          "changeOrderImpactDecisionAffectedItem",
          "changeOrderImpactDecisionHistory",
          "company",
          "item",
          "job",
          "jobMakeMethod",
          "location",
          "unitOfMeasure"
        ]
      ]
    );
    const row = result.rows[0];
    if (row?.database !== target.database || Number(row.tableCount) !== 11) {
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
        "Change Notice Impact scope PostgreSQL setup failed: the local database is not the Carbon schema for this worktree."
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
      `Change Notice Impact scope PostgreSQL setup failed: the isolated local database could not be connected (code ${code}).`
    );
  }
}

async function runWithFixture(
  options: FixtureOptions,
  callback: (fixture: Fixture) => Promise<void>
): Promise<void> {
  const pool = requireReaderPool();
  const cleanup = makeCleanupState();
  const errors: unknown[] = [];
  let fixture: Fixture | undefined;
  try {
    fixture = await createFixture(
      pool,
      cleanup,
      `impact-scope-${randomBytes(12).toString("hex")}`,
      options
    );
    await callback(fixture);
  } catch (error) {
    errors.push(error);
  }
  try {
    await cleanupFixture(pool, cleanup);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      "Change Notice Impact scope fixture failed"
    );
  }
}

async function cleanupFixture(
  pool: PostgresPool,
  cleanup: FixtureCleanup
): Promise<void> {
  const failures: Array<{ label: string; error: unknown }> = [];
  const attempt = async (label: string, operation: () => Promise<void>) => {
    try {
      await operation();
    } catch (error) {
      failures.push({ label, error });
    }
  };
  let noticeDeleted = false;

  if (cleanup.noticeId && cleanup.companyId) {
    await attempt("delete Change Notice fixture", async () => {
      const result = await pool.query(
        `DELETE FROM "changeOrder"
         WHERE "id" = $1 AND "companyId" = $2
         RETURNING "id"`,
        [cleanup.noticeId, cleanup.companyId]
      );
      assertRowCount(result, 1, "Change Notice deletion");
      noticeDeleted = true;
    });
  }
  if (
    !noticeDeleted &&
    cleanup.affectedItemIds.length > 0 &&
    cleanup.companyId
  ) {
    await attempt("delete affected-item fixtures", async () => {
      const result = await pool.query(
        `DELETE FROM "changeOrderAffectedItem"
         WHERE "id" = ANY($1::text[]) AND "companyId" = $2
         RETURNING "id"`,
        [cleanup.affectedItemIds, cleanup.companyId]
      );
      assertRowCount(
        result,
        cleanup.affectedItemIds.length,
        "affected-item deletion"
      );
    });
  }
  if (cleanup.jobIds.length > 0 && cleanup.companyId) {
    await attempt("delete Job fixtures", async () => {
      const result = await pool.query(
        `DELETE FROM "job"
         WHERE "id" = ANY($1::text[]) AND "companyId" = $2
         RETURNING "id"`,
        [cleanup.jobIds, cleanup.companyId]
      );
      assertRowCount(result, cleanup.jobIds.length, "Job deletion");
    });
  }
  if (cleanup.itemIds.length > 0 && cleanup.companyId) {
    await attempt("delete item fixtures", async () => {
      const result = await pool.query(
        `DELETE FROM "item"
         WHERE "id" = ANY($1::text[]) AND "companyId" = $2
         RETURNING "id"`,
        [cleanup.itemIds, cleanup.companyId]
      );
      assertRowCount(result, cleanup.itemIds.length, "item deletion");
    });
  }
  if (cleanup.locationId && cleanup.companyId) {
    await attempt("delete location fixture", async () => {
      const result = await pool.query(
        `DELETE FROM "location"
         WHERE "id" = $1 AND "companyId" = $2
         RETURNING "id"`,
        [cleanup.locationId, cleanup.companyId]
      );
      assertRowCount(result, 1, "location deletion");
    });
  }
  if (cleanup.unitOfMeasureCode && cleanup.companyId) {
    await attempt("delete unit-of-measure fixture", async () => {
      const result = await pool.query(
        `DELETE FROM "unitOfMeasure"
         WHERE "code" = $1 AND "companyId" = $2
         RETURNING "code"`,
        [cleanup.unitOfMeasureCode, cleanup.companyId]
      );
      assertRowCount(result, 1, "unit-of-measure deletion");
    });
  }

  for (const tableName of cleanup.generatedCompanyTables) {
    const quotedTableName = tableName.replaceAll('"', '""');
    await attempt(`drop generated company table ${tableName}`, async () => {
      await pool.query(
        `DROP TABLE IF EXISTS public."${quotedTableName}" CASCADE`
      );
    });
  }

  if (cleanup.companyId) {
    await attempt("delete company fixture", async () => {
      const result = await pool.query(
        `DELETE FROM "company" WHERE "id" = $1 RETURNING "id"`,
        [cleanup.companyId]
      );
      assertRowCount(result, 1, "company deletion");
    });
  }
  if (cleanup.userIds.length > 0) {
    await attempt("delete user fixtures", async () => {
      const result = await pool.query(
        `DELETE FROM "user"
         WHERE "id" = ANY($1::text[])
         RETURNING "id"`,
        [cleanup.userIds]
      );
      assertRowCount(result, cleanup.userIds.length, "user deletion");
    });
  }

  await attempt("verify Change Notice Impact fixture residue", () =>
    verifyNoResidue(pool, cleanup)
  );

  if (failures.length > 0) {
    throw new AggregateError(
      failures.map(({ error }) => error),
      failures.map(({ label }) => label).join("; ")
    );
  }
}

async function verifyNoResidue(
  pool: PostgresPool,
  cleanup: FixtureCleanup
): Promise<void> {
  const checks: Array<{
    label: string;
    query: string;
    parameters: unknown[];
  }> = [];
  if (cleanup.companyId) {
    checks.push({
      label: "company",
      query: `SELECT count(*)::int AS "count" FROM "company" WHERE "id" = $1`,
      parameters: [cleanup.companyId]
    });
  }
  if (cleanup.noticeId && cleanup.companyId) {
    checks.push(
      {
        label: "Change Notice",
        query: `SELECT count(*)::int AS "count"
                FROM "changeOrder"
                WHERE "id" = $1 AND "companyId" = $2`,
        parameters: [cleanup.noticeId, cleanup.companyId]
      },
      {
        label: "affected item",
        query: `SELECT count(*)::int AS "count"
                FROM "changeOrderAffectedItem"
                WHERE "id" = ANY($1::text[]) AND "companyId" = $2`,
        parameters: [cleanup.affectedItemIds, cleanup.companyId]
      },
      {
        label: "Impact decision",
        query: `SELECT count(*)::int AS "count"
                FROM "changeOrderImpactDecision"
                WHERE "companyId" = $1 AND "changeNoticeId" = $2`,
        parameters: [cleanup.companyId, cleanup.noticeId]
      },
      {
        label: "Impact provenance",
        query: `SELECT count(*)::int AS "count"
                FROM "changeOrderImpactDecisionAffectedItem"
                WHERE "companyId" = $1`,
        parameters: [cleanup.companyId]
      },
      {
        label: "Impact history",
        query: `SELECT count(*)::int AS "count"
                FROM "changeOrderImpactDecisionHistory"
                WHERE "companyId" = $1`,
        parameters: [cleanup.companyId]
      }
    );
  }
  if (cleanup.jobIds.length > 0 && cleanup.companyId) {
    checks.push(
      {
        label: "Job",
        query: `SELECT count(*)::int AS "count"
                FROM "job"
                WHERE "companyId" = $1 AND "id" = ANY($2::text[])`,
        parameters: [cleanup.companyId, cleanup.jobIds]
      },
      {
        label: "Job make-method children",
        query: `SELECT count(*)::int AS "count"
                FROM "jobMakeMethod"
                WHERE "companyId" = $1 AND "jobId" = ANY($2::text[])`,
        parameters: [cleanup.companyId, cleanup.jobIds]
      },
      {
        label: "Job material children",
        query: `SELECT count(*)::int AS "count"
                FROM "jobMaterial"
                WHERE "companyId" = $1 AND "jobId" = ANY($2::text[])`,
        parameters: [cleanup.companyId, cleanup.jobIds]
      },
      {
        label: "Job operation children",
        query: `SELECT count(*)::int AS "count"
                FROM "jobOperation"
                WHERE "companyId" = $1 AND "jobId" = ANY($2::text[])`,
        parameters: [cleanup.companyId, cleanup.jobIds]
      }
    );
  }
  if (cleanup.itemIds.length > 0 && cleanup.companyId) {
    checks.push({
      label: "Item",
      query: `SELECT count(*)::int AS "count"
              FROM "item"
              WHERE "companyId" = $1 AND "id" = ANY($2::text[])`,
      parameters: [cleanup.companyId, cleanup.itemIds]
    });
  }
  if (cleanup.locationId && cleanup.companyId) {
    checks.push({
      label: "location",
      query: `SELECT count(*)::int AS "count"
              FROM "location"
              WHERE "id" = $1 AND "companyId" = $2`,
      parameters: [cleanup.locationId, cleanup.companyId]
    });
  }
  if (cleanup.unitOfMeasureCode && cleanup.companyId) {
    checks.push({
      label: "unit of measure",
      query: `SELECT count(*)::int AS "count"
              FROM "unitOfMeasure"
              WHERE "code" = $1 AND "companyId" = $2`,
      parameters: [cleanup.unitOfMeasureCode, cleanup.companyId]
    });
  }
  if (cleanup.userIds.length > 0) {
    checks.push({
      label: "user",
      query: `SELECT count(*)::int AS "count"
              FROM "user"
              WHERE "id" = ANY($1::text[])`,
      parameters: [cleanup.userIds]
    });
  }
  for (const tableName of cleanup.generatedCompanyTables) {
    checks.push({
      label: tableName,
      query: `SELECT count(*)::int AS "count"
              FROM pg_catalog.pg_class AS relation
              JOIN pg_catalog.pg_namespace AS namespace
                ON namespace.oid = relation.relnamespace
              WHERE namespace.nspname = 'public'
                AND relation.relname = $1`,
      parameters: [tableName]
    });
  }

  for (const check of checks) {
    const result = await pool.query(check.query, check.parameters);
    const count = Number(result.rows[0]?.count ?? 0);
    if (count !== 0)
      throw new Error(`${check.label} residue count was ${count}`);
    process.stdout.write(
      `Change Notice Impact scope PostgreSQL residue ${check.label}: 0\n`
    );
  }
}

async function runInitialAssessment(
  fixture: Fixture,
  db: WriterDb,
  targetId = fixture.targetJobId,
  userId = fixture.primaryUserId
): Promise<ImpactState> {
  const result = await writeChangeNoticeImpactDecision(
    db,
    makeDecisionInput(fixture, targetId, { userId })
  );
  expect(result.error).toBeNull();
  expect(result.data?.decision.revision).toBe(1);
  return readImpactState(fixture);
}

function historySince(before: ImpactState, after: ImpactState) {
  const beforeIds = new Set(before.history.map((row) => row.id));
  return after.history.filter((row) => !beforeIds.has(row.id));
}

function provenanceFor(
  state: ImpactState,
  affectedItemId: string
): ImpactState["provenance"] {
  return state.provenance.filter(
    (row) => row.affectedItemId === affectedItemId
  );
}

describe("Change Notice Impact scope lifecycle (real PostgreSQL)", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error(
        "Change Notice Impact scope PostgreSQL setup failed: SUPABASE_DB_URL is absent or still the unit-test placeholder."
      );
    }
    const configuredTarget = requireLocalDatabaseTarget(testDatabaseUrl);
    const repositoryDatabaseUrl = readEnvValue(
      resolve(repositoryRoot, ".env.local"),
      "SUPABASE_DB_URL"
    );
    if (!repositoryDatabaseUrl) {
      throw new Error(
        "Change Notice Impact scope PostgreSQL setup failed: the current worktree .env.local database target is unavailable."
      );
    }
    assertSameDatabaseTarget(
      configuredTarget,
      requireLocalDatabaseTarget(repositoryDatabaseUrl)
    );

    process.env.SUPABASE_DB_URL = testDatabaseUrl;
    readerPool = getPostgresConnectionPool(5);
    writerPool = getPostgresConnectionPool(6);
    failurePool = getPostgresConnectionPool(7);
    racePool = getPostgresConnectionPool(8);
    await assertDatabaseConnection(readerPool, configuredTarget);

    const impactModule = await import("./items.service");
    removeChangeNoticeAffectedItem =
      impactModule.removeChangeNoticeAffectedItem;
    reconcileChangeNoticeImpactProvenance =
      impactModule.reconcileChangeNoticeImpactProvenance;
    writeChangeNoticeImpactDecision =
      impactModule.writeChangeNoticeImpactDecision;
    writerDb = getPostgresClient(writerPool, PostgresDriver);
  });

  afterAll(async () => {
    const failures: unknown[] = [];
    const pools = [readerPool, writerPool, failurePool, racePool].filter(
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

    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Change Notice Impact scope PostgreSQL teardown failed"
      );
    }
  });

  it("reconciles deleted PO lines and Job Materials through their real source queries", async () => {
    await runWithFixture({}, async (fixture) => {
      const pool = requireReaderPool();
      // Impact source IDs intentionally have no live FK; persisted decisions and
      // provenance rows model sources deleted before reconciliation.
      const cases = [
        {
          targetType: "purchaseOrderLine" as const,
          targetId: `deleted-po-${randomBytes(8).toString("hex")}`,
          decisionId: `deleted-po-decision-${randomBytes(8).toString("hex")}`,
          provenanceId: `deleted-po-provenance-${randomBytes(8).toString("hex")}`,
          snapshotSchema: "PO_LINE_SNAPSHOT_V1"
        },
        {
          targetType: "jobMaterial" as const,
          targetId: `deleted-material-${randomBytes(8).toString("hex")}`,
          decisionId: `deleted-material-decision-${randomBytes(8).toString("hex")}`,
          provenanceId: `deleted-material-provenance-${randomBytes(8).toString("hex")}`,
          snapshotSchema: "JOB_MATERIAL_SNAPSHOT_V1"
        }
      ];

      for (const target of cases) {
        await pool.query(
          `INSERT INTO "changeOrderImpactDecision"
             ("id", "companyId", "changeNoticeId", "targetType", "targetId",
              "decisionStatus", "rationale", "assessmentSnapshot", "assessedBy", "createdBy")
           VALUES ($1, $2, $3, $4, $5, 'Action required', $6, $7::jsonb, $8, $8)`,
          [
            target.decisionId,
            fixture.companyId,
            fixture.noticeId,
            target.targetType,
            target.targetId,
            "Review the deleted Impact source.",
            JSON.stringify({ schema: target.snapshotSchema }),
            fixture.primaryUserId
          ]
        );
        await pool.query(
          `INSERT INTO "changeOrderImpactDecisionAffectedItem"
             ("id", "companyId", "decisionId", "affectedItemId", "affectedItemSourceId",
              "affectedItemLabel", "startedBy", "createdBy")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [
            target.provenanceId,
            fixture.companyId,
            target.decisionId,
            fixture.affectedItemAId,
            fixture.itemAId,
            `Deleted ${target.targetType} source`,
            fixture.primaryUserId
          ]
        );
      }

      const before = await readImpactState(fixture);
      const result = await reconcileChangeNoticeImpactProvenance(
        requireWriterDb(),
        makeReconciliationInput(fixture)
      );

      expect(result).toEqual({
        data: {
          changeNoticeId: fixture.noticeId,
          changeNoticeStatus: "Draft",
          started: 0,
          ended: 2,
          restrictedTargetTypes: []
        },
        error: null
      });

      const after = await readImpactState(fixture);
      expect(after.decisions).toEqual(before.decisions);
      expect(after.provenance).toHaveLength(2);
      expect(after.history).toHaveLength(2);
      for (const target of cases) {
        const decision = before.decisions.find(
          (row) => row.targetId === target.targetId
        );
        expect(decision).toBeDefined();
        const provenance = after.provenance.find(
          (row) => row.decisionId === decision?.id
        );
        expect(provenance).toMatchObject({
          affectedItemId: fixture.affectedItemAId,
          affectedItemSourceId: fixture.itemAId,
          open: false,
          endedBy: fixture.secondaryUserId,
          endedReason: "Impact source deleted"
        });
        expect(
          after.history.find((row) => row.decisionId === decision?.id)
        ).toMatchObject({
          targetId: target.targetId,
          eventType: "Provenance ended",
          relatedAffectedItemId: fixture.affectedItemAId,
          rationale: "Impact source deleted",
          previousSnapshot: decision?.assessmentSnapshot,
          newSnapshot: decision?.assessmentSnapshot,
          createdBy: fixture.secondaryUserId
        });
      }
    });
  });

  it("replaces provenance, rolls back an injected history failure, and retries cleanly", async () => {
    await runWithFixture({ includeSecondaryTarget: true }, async (fixture) => {
      const db = requireWriterDb();
      if (
        !fixture.itemBId ||
        !fixture.secondaryJobId ||
        !fixture.affectedItemBId
      ) {
        throw new Error("Replacement fixture is incomplete");
      }
      await runInitialAssessment(fixture, db, fixture.targetJobId);
      await runInitialAssessment(fixture, db, fixture.secondaryJobId);
      const before = await readImpactState(fixture);
      const primaryDecision = before.decisions.find(
        (row) => row.targetId === fixture.targetJobId
      );
      const secondaryDecision = before.decisions.find(
        (row) => row.targetId === fixture.secondaryJobId
      );
      if (!primaryDecision || !secondaryDecision) {
        throw new Error("Replacement decisions are incomplete");
      }
      const primaryProvenanceA = before.provenance.filter(
        (row) =>
          row.decisionId === primaryDecision.id &&
          row.affectedItemId === fixture.affectedItemAId
      );
      const secondaryProvenanceB = before.provenance.filter(
        (row) =>
          row.decisionId === secondaryDecision.id &&
          row.affectedItemId === fixture.affectedItemBId
      );
      const secondaryHistory = before.history.filter(
        (row) => row.decisionId === secondaryDecision.id
      );
      expect(primaryProvenanceA).toHaveLength(1);
      expect(primaryProvenanceA[0]?.open).toBe(true);
      expect(secondaryProvenanceB).toHaveLength(1);
      expect(secondaryProvenanceB[0]?.open).toBe(true);
      expect(secondaryHistory).toHaveLength(2);
      const beforeSource = await readSourceState(fixture);

      await replaceJobSourceItem(fixture, fixture.itemBId);
      const changedSource = await readSourceState(fixture);
      expect(
        changedSource.jobs.find((row) => row.id === fixture.targetJobId)?.itemId
      ).toBe(fixture.itemBId);
      expect(
        changedSource.roots.find((row) => row.jobId === fixture.targetJobId)
          ?.itemId
      ).toBe(fixture.itemBId);
      expect(
        changedSource.jobs.find((row) => row.id === fixture.secondaryJobId)
      ).toEqual(
        beforeSource.jobs.find((row) => row.id === fixture.secondaryJobId)
      );
      expect(
        changedSource.roots.find((row) => row.jobId === fixture.secondaryJobId)
      ).toEqual(
        beforeSource.roots.find((row) => row.jobId === fixture.secondaryJobId)
      );
      expect(
        changedSource.jobs.find((row) => row.id === fixture.unrelatedJobId)
      ).toEqual(
        beforeSource.jobs.find((row) => row.id === fixture.unrelatedJobId)
      );

      const failure = makeFailOnceDriver(
        (sql) =>
          sql.startsWith('insert into "changeorderimpactdecisionhistory"'),
        "Injected reconciliation history failure"
      );
      const failureDb = getPostgresClient(requireFailurePool(), failure.driver);
      const reconciliationInput = makeReconciliationInput(fixture);
      const failed = await reconcileChangeNoticeImpactProvenance(
        failureDb,
        reconciliationInput
      );
      expect(failed).toEqual({
        data: null,
        error: { message: "Injected reconciliation history failure" }
      });
      expect(failure.didMatch()).toBe(true);

      const failedState = await readImpactState(fixture);
      expect(failedState).toEqual(before);
      expect(failedState.history).toEqual(before.history);
      expect(
        failedState.decisions.find(
          (row) => row.targetId === fixture.targetJobId
        )
      ).toEqual(primaryDecision);
      expect(
        failedState.decisions.find(
          (row) => row.targetId === fixture.secondaryJobId
        )
      ).toEqual(secondaryDecision);
      expect(
        failedState.provenance.filter(
          (row) =>
            row.decisionId === primaryDecision.id &&
            row.affectedItemId === fixture.affectedItemAId
        )
      ).toEqual(primaryProvenanceA);
      expect(
        failedState.provenance.filter(
          (row) =>
            row.decisionId === secondaryDecision.id &&
            row.affectedItemId === fixture.affectedItemBId
        )
      ).toEqual(secondaryProvenanceB);
      expect(
        failedState.history.filter(
          (row) => row.decisionId === secondaryDecision.id
        )
      ).toEqual(secondaryHistory);
      expect(historySince(before, failedState)).toEqual([]);
      expect(await readSourceState(fixture)).toEqual(changedSource);
      expect(
        await readAffectedItemCount(fixture, fixture.affectedItemAId)
      ).toBe(1);
      expect(
        await readAffectedItemCount(fixture, fixture.affectedItemBId)
      ).toBe(1);

      const retried = await reconcileChangeNoticeImpactProvenance(
        db,
        reconciliationInput
      );
      expect(retried).toEqual({
        data: {
          changeNoticeId: fixture.noticeId,
          changeNoticeStatus: "Draft",
          started: 1,
          ended: 1,
          restrictedTargetTypes: []
        },
        error: null
      });

      const finalState = await readImpactState(fixture);
      expect(finalState.decisions).toHaveLength(2);
      expect(
        finalState.decisions.find((row) => row.targetId === fixture.targetJobId)
      ).toEqual(primaryDecision);
      expect(
        finalState.decisions.find(
          (row) => row.targetId === fixture.secondaryJobId
        )
      ).toEqual(secondaryDecision);

      const primaryEndedA = finalState.provenance.filter(
        (row) =>
          row.decisionId === primaryDecision.id &&
          row.affectedItemId === fixture.affectedItemAId
      );
      const primaryStartedB = finalState.provenance.filter(
        (row) =>
          row.decisionId === primaryDecision.id &&
          row.affectedItemId === fixture.affectedItemBId
      );
      const secondaryFinalProvenanceB = finalState.provenance.filter(
        (row) =>
          row.decisionId === secondaryDecision.id &&
          row.affectedItemId === fixture.affectedItemBId
      );
      expect(finalState.provenance).toHaveLength(3);
      expect(primaryEndedA).toHaveLength(1);
      expect(primaryEndedA[0]).toMatchObject({
        id: primaryProvenanceA[0]?.id,
        open: false,
        affectedItemSourceId: fixture.itemAId,
        endedBy: fixture.secondaryUserId,
        endedReason: "Affected item provenance changed during reconciliation"
      });
      expect(primaryStartedB).toHaveLength(1);
      expect(primaryStartedB[0]).toMatchObject({
        open: true,
        affectedItemSourceId: fixture.itemBId,
        startedBy: fixture.secondaryUserId,
        endedBy: null,
        endedReason: null
      });
      expect(secondaryFinalProvenanceB).toEqual(secondaryProvenanceB);

      const openProvenance = finalState.provenance.filter((row) => row.open);
      expect(openProvenance).toHaveLength(2);
      for (const decision of [primaryDecision, secondaryDecision]) {
        expect(
          openProvenance.filter((row) => row.decisionId === decision.id)
        ).toHaveLength(1);
      }
      expect(
        new Set(
          openProvenance.map((row) => `${row.decisionId}:${row.affectedItemId}`)
        ).size
      ).toBe(openProvenance.length);

      const newHistory = historySince(before, finalState);
      expect(newHistory).toHaveLength(2);
      const primaryHistory = newHistory.filter(
        (row) => row.decisionId === primaryDecision.id
      );
      expect(primaryHistory).toHaveLength(2);
      expect(primaryHistory.map((row) => row.eventType).sort()).toEqual([
        "Provenance ended",
        "Provenance started"
      ]);
      expect(
        newHistory.filter((row) => row.decisionId === secondaryDecision.id)
      ).toEqual([]);
      expect(
        finalState.history.filter(
          (row) => row.decisionId === secondaryDecision.id
        )
      ).toEqual(secondaryHistory);
      expect(
        newHistory.find((row) => row.eventType === "Provenance started")
      ).toMatchObject({
        decisionId: primaryDecision.id,
        targetId: fixture.targetJobId,
        relatedAffectedItemId: fixture.affectedItemBId,
        rationale: "Affected item provenance started during reconciliation",
        previousSnapshot: primaryDecision.assessmentSnapshot,
        newSnapshot: primaryDecision.assessmentSnapshot,
        createdBy: fixture.secondaryUserId,
        priorAssessmentWasChanged: false
      });
      expect(
        newHistory.find((row) => row.eventType === "Provenance ended")
      ).toMatchObject({
        decisionId: primaryDecision.id,
        targetId: fixture.targetJobId,
        relatedAffectedItemId: fixture.affectedItemAId,
        rationale: "Affected item provenance changed during reconciliation",
        previousSnapshot: primaryDecision.assessmentSnapshot,
        newSnapshot: primaryDecision.assessmentSnapshot,
        createdBy: fixture.secondaryUserId,
        priorAssessmentWasChanged: false
      });
      expect(await readSourceState(fixture)).toEqual(changedSource);
    });
  });

  it("removes an affected item, preserves the decision, and leaves unrelated impact rows alone", async () => {
    await runWithFixture({ includeSecondaryTarget: true }, async (fixture) => {
      const db = requireWriterDb();
      if (!fixture.secondaryJobId || !fixture.affectedItemBId) {
        throw new Error("Removal fixture is incomplete");
      }
      await runInitialAssessment(fixture, db, fixture.targetJobId);
      await runInitialAssessment(fixture, db, fixture.secondaryJobId);
      const before = await readImpactState(fixture);
      const beforeSource = await readSourceState(fixture);
      const unrelatedDecision = before.decisions.find(
        (row) => row.targetId === fixture.secondaryJobId
      );
      const unrelatedProvenance = provenanceFor(
        before,
        fixture.affectedItemBId
      );
      expect(unrelatedDecision).toBeDefined();
      expect(unrelatedProvenance).toHaveLength(1);

      const result = await removeChangeNoticeAffectedItem(
        makeUnusedSupabaseClient(),
        db,
        fixture.affectedItemAId,
        fixture.noticeId,
        fixture.companyId,
        fixture.secondaryUserId
      );
      expect(result).toEqual({ data: null, error: null });
      expect(
        await readAffectedItemCount(fixture, fixture.affectedItemAId)
      ).toBe(0);
      expect(
        await readAffectedItemCount(fixture, fixture.affectedItemBId)
      ).toBe(1);

      const after = await readImpactState(fixture);
      expect(after.decisions).toEqual(before.decisions);
      expect(
        after.decisions.find((row) => row.targetId === fixture.secondaryJobId)
      ).toEqual(unrelatedDecision);
      expect(provenanceFor(after, fixture.affectedItemBId)).toEqual(
        unrelatedProvenance
      );
      const ended = provenanceFor(after, fixture.affectedItemAId);
      expect(ended).toHaveLength(1);
      expect(ended[0]).toMatchObject({
        open: false,
        affectedItemSourceId: fixture.itemAId,
        endedBy: fixture.secondaryUserId,
        endedReason: "Affected item removed from Change Notice"
      });
      const newHistory = historySince(before, after);
      expect(newHistory).toHaveLength(1);
      expect(newHistory[0]).toMatchObject({
        eventType: "Provenance ended",
        targetId: fixture.targetJobId,
        relatedAffectedItemId: fixture.affectedItemAId,
        previousStatus: "Action required",
        newStatus: "Action required",
        previousSnapshot: before.decisions.find(
          (row) => row.targetId === fixture.targetJobId
        )?.assessmentSnapshot,
        newSnapshot: before.decisions.find(
          (row) => row.targetId === fixture.targetJobId
        )?.assessmentSnapshot,
        rationale: "Affected item removed from Change Notice",
        createdBy: fixture.secondaryUserId,
        priorAssessmentWasChanged: false
      });
      expect(await readSourceState(fixture)).toEqual(beforeSource);
    });
  });

  it("rolls back affected-item removal after the delete and retries without residue", async () => {
    await runWithFixture({ includeSecondaryTarget: true }, async (fixture) => {
      const db = requireWriterDb();
      if (!fixture.secondaryJobId || !fixture.affectedItemBId) {
        throw new Error("Removal rollback fixture is incomplete");
      }
      await runInitialAssessment(fixture, db, fixture.targetJobId);
      await runInitialAssessment(fixture, db, fixture.secondaryJobId);
      const before = await readImpactState(fixture);
      const beforeSource = await readSourceState(fixture);

      const failure = makeFailOnceDriver(
        (sql) => sql.startsWith('delete from "changeorderaffecteditem"'),
        "Injected affected-item delete failure"
      );
      const failureDb = getPostgresClient(requireFailurePool(), failure.driver);
      const failed = await removeChangeNoticeAffectedItem(
        makeUnusedSupabaseClient(),
        failureDb,
        fixture.affectedItemAId,
        fixture.noticeId,
        fixture.companyId,
        fixture.secondaryUserId
      );
      expect(failed).toEqual({
        data: null,
        error: { message: "Injected affected-item delete failure" }
      });
      expect(failure.didMatch()).toBe(true);
      expect(await readImpactState(fixture)).toEqual(before);
      expect(await readSourceState(fixture)).toEqual(beforeSource);
      expect(
        await readAffectedItemCount(fixture, fixture.affectedItemAId)
      ).toBe(1);
      expect(
        await readAffectedItemCount(fixture, fixture.affectedItemBId)
      ).toBe(1);

      const retry = await removeChangeNoticeAffectedItem(
        makeUnusedSupabaseClient(),
        db,
        fixture.affectedItemAId,
        fixture.noticeId,
        fixture.companyId,
        fixture.secondaryUserId
      );
      expect(retry).toEqual({ data: null, error: null });
      expect(
        await readAffectedItemCount(fixture, fixture.affectedItemAId)
      ).toBe(0);
      expect(
        await readAffectedItemCount(fixture, fixture.affectedItemBId)
      ).toBe(1);
      const after = await readImpactState(fixture);
      expect(after.decisions).toEqual(before.decisions);
      expect(provenanceFor(after, fixture.affectedItemBId)).toEqual(
        provenanceFor(before, fixture.affectedItemBId)
      );
      expect(provenanceFor(after, fixture.affectedItemAId)[0]).toMatchObject({
        open: false,
        endedBy: fixture.secondaryUserId,
        endedReason: "Affected item removed from Change Notice"
      });
      expect(historySince(before, after).map((row) => row.eventType)).toEqual([
        "Provenance ended"
      ]);
      expect(await readSourceState(fixture)).toEqual(beforeSource);
    });
  });

  it("serializes reassessment versus removal at the Change Notice lock without deadlock or orphan current provenance", async () => {
    await runWithFixture({}, async (fixture) => {
      const db = requireWriterDb();
      const initial = await runInitialAssessment(fixture, db);
      await updateJobQuantityComplete(fixture, 3);
      const beforeSource = await readSourceState(fixture);
      const racePoolValue = racePool;
      if (!racePoolValue)
        throw new Error("Race PostgreSQL pool was not initialized");
      const rendezvous = new ParentLockRendezvous(2, 3_000);
      const AssessmentDriver = makeParentLockRendezvousDriver(rendezvous);
      const RemovalDriver = makeParentLockRendezvousDriver(rendezvous);
      const assessmentDb = getPostgresClient(racePoolValue, AssessmentDriver);
      const removalDb = getPostgresClient(racePoolValue, RemovalDriver);
      const [assessment, removal] = await Promise.all([
        writeChangeNoticeImpactDecision(
          assessmentDb,
          makeDecisionInput(fixture, fixture.targetJobId, {
            expectedRevision: 1,
            rationale: "The reassessment confirms the changed completion state."
          })
        ),
        removeChangeNoticeAffectedItem(
          makeUnusedSupabaseClient(),
          removalDb,
          fixture.affectedItemAId,
          fixture.noticeId,
          fixture.companyId,
          fixture.secondaryUserId
        )
      ]);

      expect(rendezvous.arrivals).toBe(2);
      expect(rendezvous.released).toBe(true);
      expect(rendezvous.maxConcurrentWaiters).toBe(2);
      expect(removal).toEqual({ data: null, error: null });
      expect([
        null,
        {
          message:
            "Impact target is no longer in the current Change Notice scope."
        }
      ]).toContainEqual(assessment.error);
      expect(
        await readAffectedItemCount(fixture, fixture.affectedItemAId)
      ).toBe(0);

      const after = await readImpactState(fixture);
      expect(after.decisions).toHaveLength(1);
      const finalDecision = after.decisions[0];
      expect(finalDecision).toMatchObject({
        id: initial.decisions[0]?.id,
        targetId: fixture.targetJobId,
        decisionStatus: "Action required"
      });
      const newHistory = historySince(initial, after);
      if (assessment.error === null) {
        expect(assessment.data).toMatchObject({
          operation: "updateDecision",
          decision: { revision: 2 }
        });
        expect(finalDecision).toMatchObject({
          revision: 2,
          rationale: "The reassessment confirms the changed completion state.",
          assessedBy: fixture.primaryUserId,
          assessmentSnapshot: {
            completedQuantity: 3,
            remainingQuantity: 7
          }
        });
        expect(newHistory.map((row) => row.eventType).sort()).toEqual([
          "Decision reassessed",
          "Provenance ended"
        ]);
        expect(
          newHistory.find((row) => row.eventType === "Decision reassessed")
        ).toMatchObject({
          previousSnapshot: initial.decisions[0]?.assessmentSnapshot,
          newSnapshot: finalDecision?.assessmentSnapshot,
          priorAssessmentWasChanged: true,
          createdBy: fixture.primaryUserId
        });
      } else {
        expect(assessment).toEqual({
          data: null,
          error: {
            message:
              "Impact target is no longer in the current Change Notice scope."
          }
        });
        expect(after.decisions).toEqual(initial.decisions);
        expect(newHistory.map((row) => row.eventType)).toEqual([
          "Provenance ended"
        ]);
      }
      expect(after.provenance.filter((row) => row.open)).toHaveLength(0);
      const endedProvenance = provenanceFor(after, fixture.affectedItemAId);
      expect(endedProvenance).toHaveLength(1);
      expect(endedProvenance[0]).toMatchObject({
        open: false,
        endedBy: fixture.secondaryUserId,
        endedReason: "Affected item removed from Change Notice"
      });
      expect(await readSourceState(fixture)).toEqual(beforeSource);
    });
  });
});
