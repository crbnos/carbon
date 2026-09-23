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
  ChangeNoticeImpactDecisionMutationInput,
  ChangeNoticeImpactSourceAccess,
  ChangeNoticeImpactTaskCreateMutationInput,
  ChangeNoticeImpactTaskRelationshipMutationInput
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

type Fixture = {
  companyId: string;
  primaryUserId: string;
  secondaryUserId: string;
  noticeId: string;
  affectedItemId: string;
  affectedItemIds: string[];
  itemId: string;
  jobId: string;
  jobMakeMethodId: string;
  unitOfMeasureCode: string;
  locationId: string;
  actionTaskIds: string[];
  extraJobIds: string[];
  draftItemIds: string[];
  draftMakeMethodIds: string[];
};

type FixtureCleanup = {
  companyId?: string;
  userIds: string[];
  noticeId?: string;
  affectedItemIds: string[];
  itemId?: string;
  jobId?: string;
  unitOfMeasureCode?: string;
  locationId?: string;
  actionTaskIds: string[];
  extraJobIds: string[];
  draftItemIds: string[];
  draftMakeMethodIds: string[];
  generatedCompanyTables: string[];
  noticeDeleted: boolean;
};

type DraftReferences = {
  affectedItemId: string;
  draftItemId: string;
  draftItemMethodId: string;
  standaloneDraftMethodId: string;
};

type DraftReferenceState = {
  affectedItems: Array<{
    id: string;
    changeOrderId: string;
    itemId: string;
    draftMakeMethodId: string | null;
    newItemId: string | null;
    companyId: string;
  }>;
  draftItem: {
    id: string;
    companyId: string;
    changeOrderId: string | null;
    active: boolean;
    revisionStatus: string;
  } | null;
  makeMethods: Array<{
    id: string;
    itemId: string;
    companyId: string;
    changeOrderId: string | null;
    status: string;
    version: number;
  }>;
};

type ImpactState = {
  decisions: Array<{
    id: string;
    targetId: string;
    decisionStatus: string;
    noActionReasonCode: string | null;
    rationale: string | null;
    resolutionNote: string | null;
    revision: number;
  }>;
  tasks: Array<{
    id: string;
    name: string | null;
    status: string;
    taskOrigin: string;
    sortOrder: number;
  }>;
  links: Array<{
    decisionId: string;
    actionTaskId: string;
  }>;
  history: Array<{
    id: string;
    decisionId: string;
    targetId: string;
    eventType: string;
    previousStatus: string | null;
    newStatus: string | null;
    relatedActionTaskId: string | null;
    priorAssessmentWasChanged: boolean;
    rationale: string | null;
    createdBy: string;
  }>;
};

type ImpactCounts = {
  changeNotice: number;
  affectedItem: number;
  decision: number;
  provenance: number;
  link: number;
  history: number;
  actionTask: number;
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
let writerDb: WriterDb | undefined;
let createChangeNoticeImpactTask: ImpactModule["createChangeNoticeImpactTask"];
let linkChangeNoticeImpactTask: ImpactModule["linkChangeNoticeImpactTask"];
let unlinkChangeNoticeImpactTask: ImpactModule["unlinkChangeNoticeImpactTask"];
let designateChangeNoticeImpactTask: ImpactModule["designateChangeNoticeImpactTask"];
let writeChangeNoticeImpactDecision: ImpactModule["writeChangeNoticeImpactDecision"];
let deleteChangeNotice: ImpactModule["deleteChangeNotice"];

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
      "Change Notice Impact tasks PostgreSQL setup failed: SUPABASE_DB_URL is malformed."
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  let database: string;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw new Error(
      "Change Notice Impact tasks PostgreSQL setup failed: SUPABASE_DB_URL is malformed."
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !isLocalHost ||
    database !== "postgres" ||
    !parsed.username
  ) {
    throw new Error(
      "Change Notice Impact tasks PostgreSQL setup failed: SUPABASE_DB_URL must identify the isolated local Carbon PostgreSQL database."
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
      "Change Notice Impact tasks PostgreSQL setup failed: SUPABASE_DB_URL does not match the current worktree's .env.local database target."
    );
  }
}

function makeCleanupState(): FixtureCleanup {
  return {
    userIds: [],
    affectedItemIds: [],
    actionTaskIds: [],
    extraJobIds: [],
    draftItemIds: [],
    draftMakeMethodIds: [],
    generatedCompanyTables: [],
    noticeDeleted: false
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
  prefix: string
): Promise<Fixture> {
  const primaryUserId = `${prefix}-primary`;
  const secondaryUserId = `${prefix}-secondary`;
  for (const [index, userId] of [primaryUserId, secondaryUserId].entries()) {
    const result = await pool.query(
      `INSERT INTO "user" ("id", "email", "firstName", "lastName")
       VALUES ($1, $2, $3, $4)
       RETURNING "id"`,
      [userId, `${userId}@example.test`, "Impact", `Tasks ${index + 1}`]
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
  const itemId = String(itemResult.rows[0].id);
  cleanup.itemId = itemId;

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

  const affectedItemResult = await pool.query(
    `INSERT INTO "changeOrderAffectedItem"
       ("changeOrderId", "itemId", "companyId", "createdBy")
     VALUES ($1, $2, $3, $4)
     RETURNING "id"`,
    [noticeId, itemId, companyId, primaryUserId]
  );
  assertExactlyOneRow(affectedItemResult, "affected item");
  const affectedItemId = String(affectedItemResult.rows[0].id);
  cleanup.affectedItemIds.push(affectedItemId);

  const jobResult = await pool.query(
    `INSERT INTO "job"
       ("jobId", "itemId", "unitOfMeasureCode", "locationId", "status",
        "quantity", "quantityComplete", "companyId", "createdBy")
     VALUES ($1, $2, $3, $4, 'Draft', 10, 2, $5, $6)
     RETURNING "id"`,
    [
      `${prefix}-job`,
      itemId,
      unitOfMeasureCode,
      locationId,
      companyId,
      primaryUserId
    ]
  );
  assertExactlyOneRow(jobResult, "job");
  const jobId = String(jobResult.rows[0].id);
  cleanup.jobId = jobId;

  const methodResult = await pool.query(
    `SELECT "id"
     FROM "jobMakeMethod"
     WHERE "companyId" = $1 AND "jobId" = $2 AND "parentMaterialId" IS NULL
     ORDER BY "id"
     LIMIT 2`,
    [companyId, jobId]
  );
  assertExactlyOneRow(methodResult, "root job make-method");
  const jobMakeMethodId = String(methodResult.rows[0].id);

  return {
    companyId,
    primaryUserId,
    secondaryUserId,
    noticeId,
    affectedItemId,
    affectedItemIds: cleanup.affectedItemIds,
    itemId,
    jobId,
    jobMakeMethodId,
    unitOfMeasureCode,
    locationId,
    actionTaskIds: cleanup.actionTaskIds,
    extraJobIds: cleanup.extraJobIds,
    draftItemIds: cleanup.draftItemIds,
    draftMakeMethodIds: cleanup.draftMakeMethodIds
  };
}

async function insertAdditionalJob(
  fixture: Fixture,
  suffix: string
): Promise<string> {
  const result = await requireReaderPool().query(
    `INSERT INTO "job"
       ("jobId", "itemId", "unitOfMeasureCode", "locationId", "status",
        "quantity", "quantityComplete", "companyId", "createdBy")
     VALUES ($1, $2, $3, $4, 'Draft', 10, 2, $5, $6)
     RETURNING "id"`,
    [
      `${fixture.jobId}-${suffix}`,
      fixture.itemId,
      fixture.unitOfMeasureCode,
      fixture.locationId,
      fixture.companyId,
      fixture.primaryUserId
    ]
  );
  assertExactlyOneRow(result, "additional job");
  const jobId = String(result.rows[0].id);
  fixture.extraJobIds.push(jobId);
  return jobId;
}

async function createDraftReferences(
  fixture: Fixture
): Promise<DraftReferences> {
  const pool = requireReaderPool();
  const draftReadableId = `${fixture.itemId}-draft`;
  const draftItemResult = await pool.query(
    `INSERT INTO "item"
       ("readableId", "revision", "name", "type", "replenishmentSystem",
        "defaultMethodType", "itemTrackingType", "unitOfMeasureCode", "active",
        "revisionStatus", "changeOrderId", "companyId", "createdBy")
     VALUES ($1, '0', $2, 'Part', 'Make', 'Make to Order', 'Inventory', $3,
             false, 'Design', $4, $5, $6)
     RETURNING "id"`,
    [
      draftReadableId,
      `${fixture.itemId} draft item`,
      fixture.unitOfMeasureCode,
      fixture.noticeId,
      fixture.companyId,
      fixture.primaryUserId
    ]
  );
  assertExactlyOneRow(draftItemResult, "Change Notice draft item");
  const draftItemId = String(draftItemResult.rows[0].id);
  fixture.draftItemIds.push(draftItemId);

  const partResult = await pool.query(
    `INSERT INTO "part" ("id", "companyId", "createdBy")
     VALUES ($1, $2, $3)
     RETURNING "id"`,
    [draftReadableId, fixture.companyId, fixture.primaryUserId]
  );
  assertExactlyOneRow(partResult, "Change Notice draft part");

  const draftMethodResult = await pool.query(
    `SELECT "id"
     FROM "makeMethod"
     WHERE "itemId" = $1 AND "companyId" = $2 AND "status" = 'Draft'
     ORDER BY "createdAt" DESC, "id" DESC
     LIMIT 1`,
    [draftItemId, fixture.companyId]
  );
  assertExactlyOneRow(draftMethodResult, "Change Notice draft item method");
  const draftItemMethodId = String(draftMethodResult.rows[0].id);
  fixture.draftMakeMethodIds.push(draftItemMethodId);

  const stampDraftMethod = await pool.query(
    `UPDATE "makeMethod"
     SET "changeOrderId" = $1
     WHERE "id" = $2 AND "companyId" = $3
     RETURNING "id"`,
    [fixture.noticeId, draftItemMethodId, fixture.companyId]
  );
  assertRowCount(stampDraftMethod, 1, "Change Notice draft item method stamp");

  const standaloneMethodResult = await pool.query(
    `INSERT INTO "makeMethod"
       ("itemId", "companyId", "createdBy", "version", "status", "changeOrderId")
     VALUES ($1, $2, $3, 2, 'Draft', $4)
     RETURNING "id"`,
    [fixture.itemId, fixture.companyId, fixture.primaryUserId, fixture.noticeId]
  );
  assertExactlyOneRow(
    standaloneMethodResult,
    "standalone Change Notice draft method"
  );
  const standaloneDraftMethodId = String(standaloneMethodResult.rows[0].id);
  fixture.draftMakeMethodIds.push(standaloneDraftMethodId);

  const updatedAffectedItem = await pool.query(
    `UPDATE "changeOrderAffectedItem"
     SET "draftMakeMethodId" = $1, "updatedBy" = $2
     WHERE "id" = $3 AND "companyId" = $4
     RETURNING "id"`,
    [
      standaloneDraftMethodId,
      fixture.primaryUserId,
      fixture.affectedItemId,
      fixture.companyId
    ]
  );
  assertRowCount(updatedAffectedItem, 1, "standalone draft method reference");

  const addedAffectedItem = await pool.query(
    `INSERT INTO "changeOrderAffectedItem"
       ("changeOrderId", "itemId", "sortOrder", "changeType",
        "draftMakeMethodId", "newItemId", "companyId", "createdBy")
     VALUES ($1, $2, 1, 'New Part', $3, $2, $4, $5)
     RETURNING "id"`,
    [
      fixture.noticeId,
      draftItemId,
      draftItemMethodId,
      fixture.companyId,
      fixture.primaryUserId
    ]
  );
  assertExactlyOneRow(addedAffectedItem, "draft item affected item");
  const affectedItemId = String(addedAffectedItem.rows[0].id);
  fixture.affectedItemIds.push(affectedItemId);

  return {
    affectedItemId,
    draftItemId,
    draftItemMethodId,
    standaloneDraftMethodId
  };
}

async function readDraftReferenceState(
  fixture: Fixture,
  references: DraftReferences
): Promise<DraftReferenceState> {
  const pool = requireReaderPool();
  const [affectedItems, draftItem, makeMethods] = await Promise.all([
    pool.query(
      `SELECT "id", "changeOrderId", "itemId", "draftMakeMethodId",
              "newItemId", "companyId"
       FROM "changeOrderAffectedItem"
       WHERE "changeOrderId" = $1 AND "companyId" = $2
       ORDER BY "sortOrder", "createdAt", "id"`,
      [fixture.noticeId, fixture.companyId]
    ),
    pool.query(
      `SELECT "id", "companyId", "changeOrderId", "active", "revisionStatus"
       FROM "item"
       WHERE "id" = $1 AND "companyId" = $2`,
      [references.draftItemId, fixture.companyId]
    ),
    pool.query(
      `SELECT "id", "itemId", "companyId", "changeOrderId", "status", "version"
       FROM "makeMethod"
       WHERE "id" = ANY($1::text[]) AND "companyId" = $2
       ORDER BY "id"`,
      [
        [references.draftItemMethodId, references.standaloneDraftMethodId],
        fixture.companyId
      ]
    )
  ]);

  return {
    affectedItems: affectedItems.rows.map((row) => ({
      id: String(row.id),
      changeOrderId: String(row.changeOrderId),
      itemId: String(row.itemId),
      draftMakeMethodId:
        row.draftMakeMethodId === null ? null : String(row.draftMakeMethodId),
      newItemId: row.newItemId === null ? null : String(row.newItemId),
      companyId: String(row.companyId)
    })),
    draftItem:
      draftItem.rows[0] === undefined
        ? null
        : {
            id: String(draftItem.rows[0].id),
            companyId: String(draftItem.rows[0].companyId),
            changeOrderId:
              draftItem.rows[0].changeOrderId === null
                ? null
                : String(draftItem.rows[0].changeOrderId),
            active: Boolean(draftItem.rows[0].active),
            revisionStatus: String(draftItem.rows[0].revisionStatus)
          },
    makeMethods: makeMethods.rows.map((row) => ({
      id: String(row.id),
      itemId: String(row.itemId),
      companyId: String(row.companyId),
      changeOrderId:
        row.changeOrderId === null ? null : String(row.changeOrderId),
      status: String(row.status),
      version: Number(row.version)
    }))
  };
}

function makeDecisionInput(
  fixture: Fixture,
  overrides: Partial<ChangeNoticeImpactDecisionMutationInput> = {}
): ChangeNoticeImpactDecisionMutationInput {
  return {
    changeNoticeId: fixture.noticeId,
    targetType: "job",
    targetId: fixture.jobId,
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

function makeTaskCreateInput(
  fixture: Fixture,
  decisionId: string,
  overrides: Partial<ChangeNoticeImpactTaskCreateMutationInput> = {}
): ChangeNoticeImpactTaskCreateMutationInput {
  return {
    changeNoticeId: fixture.noticeId,
    targetType: "job",
    targetId: fixture.jobId,
    decision: {
      decisionId,
      targetType: "job",
      targetId: fixture.jobId
    },
    task: {
      name: "Confirm operational cut-in",
      notes: { summary: "Confirm the production follow-up." },
      assignee: fixture.secondaryUserId
    },
    companyId: fixture.companyId,
    userId: fixture.primaryUserId,
    sourceAccess,
    ...overrides
  };
}

function makeBootstrapTaskInput(
  fixture: Fixture
): ChangeNoticeImpactTaskCreateMutationInput {
  return {
    changeNoticeId: fixture.noticeId,
    targetType: "job",
    targetId: fixture.jobId,
    decision: undefined,
    bootstrapDecision: {
      decisionStatus: "Action required",
      rationale: "Production must confirm the operational cut-in."
    },
    task: {
      name: "Confirm operational cut-in",
      notes: { summary: "Confirm the production follow-up." },
      assignee: fixture.secondaryUserId
    },
    companyId: fixture.companyId,
    userId: fixture.primaryUserId,
    sourceAccess
  };
}

function makeRelationshipInput(
  fixture: Fixture,
  decisionId: string,
  actionTaskId: string,
  overrides: Partial<ChangeNoticeImpactTaskRelationshipMutationInput> = {}
): ChangeNoticeImpactTaskRelationshipMutationInput {
  return {
    changeNoticeId: fixture.noticeId,
    decisionId,
    targetType: "job",
    targetId: fixture.jobId,
    actionTaskId,
    companyId: fixture.companyId,
    userId: fixture.secondaryUserId,
    sourceAccess,
    ...overrides
  };
}

async function insertOrdinaryTask(
  fixture: Fixture,
  name: string
): Promise<string> {
  const result = await requireReaderPool().query(
    `INSERT INTO "changeOrderActionTask"
       ("changeOrderId", "name", "status", "actionTypeId", "sortOrder",
        "companyId", "createdBy", "taskOrigin")
     VALUES ($1, $2, 'Pending', NULL, 1, $3, $4, 'Manual')
     RETURNING "id"`,
    [fixture.noticeId, name, fixture.companyId, fixture.primaryUserId]
  );
  assertExactlyOneRow(result, "ordinary action task");
  const actionTaskId = String(result.rows[0].id);
  fixture.actionTaskIds.push(actionTaskId);
  return actionTaskId;
}

function recordActionTask(fixture: Fixture, actionTaskId: string): void {
  if (!fixture.actionTaskIds.includes(actionTaskId)) {
    fixture.actionTaskIds.push(actionTaskId);
  }
}

async function updateTaskStatus(
  fixture: Fixture,
  actionTaskId: string,
  status: "Completed" | "Skipped"
): Promise<void> {
  const result = await requireReaderPool().query(
    `UPDATE "changeOrderActionTask"
     SET "status" = $1,
         "completedDate" = CASE WHEN $1::"changeOrderTaskStatus" = 'Completed' THEN CURRENT_DATE ELSE NULL END,
         "updatedBy" = $2,
         "updatedAt" = NOW()
     WHERE "id" = $3 AND "changeOrderId" = $4 AND "companyId" = $5
     RETURNING "id"`,
    [
      status,
      fixture.secondaryUserId,
      actionTaskId,
      fixture.noticeId,
      fixture.companyId
    ]
  );
  assertRowCount(result, 1, `task ${status} update`);
}

async function createInitialDecision(
  fixture: Fixture,
  db: WriterDb
): Promise<string> {
  const result = await writeChangeNoticeImpactDecision(
    db,
    makeDecisionInput(fixture)
  );
  expect(result).toMatchObject({
    error: null,
    data: {
      operation: "createDecision",
      decision: {
        targetType: "job",
        targetId: fixture.jobId,
        decisionStatus: "Action required",
        revision: 1
      }
    }
  });
  if (!result.data) throw new Error("Initial Impact decision was not created");
  return result.data.decision.id;
}

async function readImpactState(fixture: Fixture): Promise<ImpactState> {
  const pool = requireReaderPool();
  const [decisions, tasks, links, history] = await Promise.all([
    pool.query(
      `SELECT "id", "targetId", "decisionStatus", "noActionReasonCode",
              "rationale", "resolutionNote", "revision"
       FROM "changeOrderImpactDecision"
       WHERE "companyId" = $1 AND "changeNoticeId" = $2
       ORDER BY "targetId", "id"`,
      [fixture.companyId, fixture.noticeId]
    ),
    pool.query(
      `SELECT "id", "name", "status", "taskOrigin", "sortOrder"
       FROM "changeOrderActionTask"
       WHERE "companyId" = $1 AND "changeOrderId" = $2
       ORDER BY "sortOrder", "id"`,
      [fixture.companyId, fixture.noticeId]
    ),
    pool.query(
      `SELECT "decisionId", "actionTaskId"
       FROM "changeOrderImpactDecisionActionTask"
       WHERE "companyId" = $1
       ORDER BY "decisionId", "actionTaskId"`,
      [fixture.companyId]
    ),
    pool.query(
      `SELECT "id", "decisionId", "targetId", "eventType", "previousStatus",
              "newStatus", "relatedActionTaskId", "priorAssessmentWasChanged",
              "rationale", "createdBy"
       FROM "changeOrderImpactDecisionHistory"
       WHERE "companyId" = $1
       ORDER BY "createdAt", "id"`,
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
      revision: Number(row.revision)
    })),
    tasks: tasks.rows.map((row) => ({
      id: String(row.id),
      name: row.name === null ? null : String(row.name),
      status: String(row.status),
      taskOrigin: String(row.taskOrigin),
      sortOrder: Number(row.sortOrder)
    })),
    links: links.rows.map((row) => ({
      decisionId: String(row.decisionId),
      actionTaskId: String(row.actionTaskId)
    })),
    history: history.rows.map((row) => ({
      id: String(row.id),
      decisionId: String(row.decisionId),
      targetId: String(row.targetId),
      eventType: String(row.eventType),
      previousStatus: row.previousStatus,
      newStatus: row.newStatus,
      relatedActionTaskId:
        row.relatedActionTaskId === null
          ? null
          : String(row.relatedActionTaskId),
      priorAssessmentWasChanged: Boolean(row.priorAssessmentWasChanged),
      rationale: row.rationale,
      createdBy: String(row.createdBy)
    }))
  };
}

async function readImpactCounts(fixture: Fixture): Promise<ImpactCounts> {
  const pool = requireReaderPool();
  const queries = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS "count"
       FROM "changeOrder" WHERE "id" = $1 AND "companyId" = $2`,
      [fixture.noticeId, fixture.companyId]
    ),
    pool.query(
      `SELECT count(*)::int AS "count"
       FROM "changeOrderAffectedItem"
       WHERE "id" = $1 AND "changeOrderId" = $2 AND "companyId" = $3`,
      [fixture.affectedItemId, fixture.noticeId, fixture.companyId]
    ),
    pool.query(
      `SELECT count(*)::int AS "count"
       FROM "changeOrderImpactDecision"
       WHERE "companyId" = $1 AND "changeNoticeId" = $2`,
      [fixture.companyId, fixture.noticeId]
    ),
    pool.query(
      `SELECT count(*)::int AS "count"
       FROM "changeOrderImpactDecisionAffectedItem"
       WHERE "companyId" = $1`,
      [fixture.companyId]
    ),
    pool.query(
      `SELECT count(*)::int AS "count"
       FROM "changeOrderImpactDecisionActionTask"
       WHERE "companyId" = $1`,
      [fixture.companyId]
    ),
    pool.query(
      `SELECT count(*)::int AS "count"
       FROM "changeOrderImpactDecisionHistory"
       WHERE "companyId" = $1`,
      [fixture.companyId]
    ),
    pool.query(
      `SELECT count(*)::int AS "count"
       FROM "changeOrderActionTask"
       WHERE "id" = ANY($1::text[]) AND "companyId" = $2`,
      [fixture.actionTaskIds, fixture.companyId]
    )
  ]);
  return {
    changeNotice: Number(queries[0].rows[0]?.count ?? 0),
    affectedItem: Number(queries[1].rows[0]?.count ?? 0),
    decision: Number(queries[2].rows[0]?.count ?? 0),
    provenance: Number(queries[3].rows[0]?.count ?? 0),
    link: Number(queries[4].rows[0]?.count ?? 0),
    history: Number(queries[5].rows[0]?.count ?? 0),
    actionTask: Number(queries[6].rows[0]?.count ?? 0)
  };
}

async function readSourceCounts(fixture: Fixture): Promise<{
  item: number;
  job: number;
}> {
  const [item, job] = await Promise.all([
    requireReaderPool().query(
      `SELECT count(*)::int AS "count"
       FROM "item" WHERE "id" = $1 AND "companyId" = $2`,
      [fixture.itemId, fixture.companyId]
    ),
    requireReaderPool().query(
      `SELECT count(*)::int AS "count"
       FROM "job" WHERE "id" = $1 AND "companyId" = $2`,
      [fixture.jobId, fixture.companyId]
    )
  ]);
  return {
    item: Number(item.rows[0]?.count ?? 0),
    job: Number(job.rows[0]?.count ?? 0)
  };
}

function makeFailOnceTaskLinkedHistoryDriver(): {
  driver: typeof PostgresDriver;
  didMatch: () => boolean;
} {
  let matched = false;
  let failed = false;

  class FailOnceTaskLinkedHistoryDriver extends PostgresDriver {
    override async acquireConnection() {
      const connection = await super.acquireConnection();
      const executeQuery: ExecuteQuery =
        connection.executeQuery.bind(connection);
      connection.executeQuery = async <R>(
        compiledQuery: Parameters<ExecuteQuery>[0]
      ) => {
        const result = await executeQuery<R>(compiledQuery);
        const normalizedSql = compiledQuery.sql
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        const hasTaskLinkedEvent = compiledQuery.parameters.some(
          (parameter) => parameter === "Task linked"
        );
        if (
          !failed &&
          normalizedSql.startsWith(
            'insert into "changeorderimpactdecisionhistory"'
          ) &&
          hasTaskLinkedEvent
        ) {
          matched = true;
          failed = true;
          throw new Error("Injected Task linked history failure");
        }
        return result;
      };
      return connection;
    }
  }

  return { driver: FailOnceTaskLinkedHistoryDriver, didMatch: () => matched };
}

function normalizePostgresSql(sql: string): string {
  return sql.replace(/\$\d+/g, "?").replace(/\s+/g, " ").trim().toLowerCase();
}

const PARENT_DELETE_SQL =
  'delete from "changeorder" where "id" = ? and "companyid" = ?';

function makeFailOnceParentDeleteDriver(): {
  driver: typeof PostgresDriver;
  didMatch: () => boolean;
} {
  let matched = false;
  let failed = false;

  class FailOnceParentDeleteDriver extends PostgresDriver {
    override async acquireConnection() {
      const connection = await super.acquireConnection();
      const executeQuery: ExecuteQuery =
        connection.executeQuery.bind(connection);
      connection.executeQuery = async <R>(
        compiledQuery: Parameters<ExecuteQuery>[0]
      ) => {
        const result = await executeQuery<R>(compiledQuery);
        if (
          !failed &&
          normalizePostgresSql(compiledQuery.sql) === PARENT_DELETE_SQL
        ) {
          matched = true;
          failed = true;
          throw new Error("Injected parent delete failure");
        }
        return result;
      };
      return connection;
    }
  }

  return { driver: FailOnceParentDeleteDriver, didMatch: () => matched };
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
          "changeOrderActionTask",
          "changeOrderImpactDecision",
          "changeOrderImpactDecisionAffectedItem",
          "changeOrderImpactDecisionActionTask",
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
    if (row?.database !== target.database || Number(row.tableCount) !== 13) {
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
        "Change Notice Impact tasks PostgreSQL setup failed: the local database is not the Carbon schema for this worktree."
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
      `Change Notice Impact tasks PostgreSQL setup failed: the isolated local database could not be connected (code ${code}).`
    );
  }
}

function requireReaderPool(): PostgresPool {
  if (!readerPool)
    throw new Error("Real PostgreSQL task reader pool was not initialized");
  return readerPool;
}

function requireWriterPool(): PostgresPool {
  if (!writerPool)
    throw new Error("Real PostgreSQL task writer pool was not initialized");
  return writerPool;
}

function requireWriterDb(): WriterDb {
  if (!writerDb)
    throw new Error("Real PostgreSQL task writer was not initialized");
  return writerDb;
}

function requireFailurePool(): PostgresPool {
  if (!failurePool)
    throw new Error("Failure-injection PostgreSQL pool was not initialized");
  return failurePool;
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
        label: "Impact task link",
        query: `SELECT count(*)::int AS "count"
                FROM "changeOrderImpactDecisionActionTask"
                WHERE "companyId" = $1`,
        parameters: [cleanup.companyId]
      },
      {
        label: "Impact history",
        query: `SELECT count(*)::int AS "count"
                FROM "changeOrderImpactDecisionHistory"
                WHERE "companyId" = $1`,
        parameters: [cleanup.companyId]
      },
      {
        label: "action task",
        query: `SELECT count(*)::int AS "count"
                FROM "changeOrderActionTask"
                WHERE "changeOrderId" = $1 AND "companyId" = $2`,
        parameters: [cleanup.noticeId, cleanup.companyId]
      }
    );
  }
  if (cleanup.jobId && cleanup.companyId) {
    checks.push(
      {
        label: "Job",
        query: `SELECT count(*)::int AS "count"
                FROM "job" WHERE "id" = $1 AND "companyId" = $2`,
        parameters: [cleanup.jobId, cleanup.companyId]
      },
      {
        label: "Job make-method children",
        query: `SELECT count(*)::int AS "count"
                FROM "jobMakeMethod" WHERE "jobId" = $1 AND "companyId" = $2`,
        parameters: [cleanup.jobId, cleanup.companyId]
      }
    );
  }
  if (cleanup.itemId && cleanup.companyId) {
    checks.push({
      label: "Item",
      query: `SELECT count(*)::int AS "count"
              FROM "item" WHERE "id" = $1 AND "companyId" = $2`,
      parameters: [cleanup.itemId, cleanup.companyId]
    });
  }
  for (const jobId of cleanup.extraJobIds) {
    checks.push(
      {
        label: `additional Job ${jobId}`,
        query: `SELECT count(*)::int AS "count"
                FROM "job" WHERE "id" = $1 AND "companyId" = $2`,
        parameters: [jobId, cleanup.companyId]
      },
      {
        label: `additional Job make-method children ${jobId}`,
        query: `SELECT count(*)::int AS "count"
                FROM "jobMakeMethod" WHERE "jobId" = $1 AND "companyId" = $2`,
        parameters: [jobId, cleanup.companyId]
      }
    );
  }
  for (const itemId of cleanup.draftItemIds) {
    checks.push({
      label: `Change Notice draft Item ${itemId}`,
      query: `SELECT count(*)::int AS "count"
              FROM "item" WHERE "id" = $1 AND "companyId" = $2`,
      parameters: [itemId, cleanup.companyId]
    });
  }
  for (const methodId of cleanup.draftMakeMethodIds) {
    checks.push({
      label: `Change Notice draft make-method ${methodId}`,
      query: `SELECT count(*)::int AS "count"
              FROM "makeMethod" WHERE "id" = $1 AND "companyId" = $2`,
      parameters: [methodId, cleanup.companyId]
    });
  }
  if (cleanup.locationId && cleanup.companyId) {
    checks.push({
      label: "location",
      query: `SELECT count(*)::int AS "count"
              FROM "location" WHERE "id" = $1 AND "companyId" = $2`,
      parameters: [cleanup.locationId, cleanup.companyId]
    });
  }
  if (cleanup.unitOfMeasureCode && cleanup.companyId) {
    checks.push({
      label: "unit of measure",
      query: `SELECT count(*)::int AS "count"
              FROM "unitOfMeasure" WHERE "code" = $1 AND "companyId" = $2`,
      parameters: [cleanup.unitOfMeasureCode, cleanup.companyId]
    });
  }
  if (cleanup.userIds.length > 0) {
    checks.push({
      label: "user",
      query: `SELECT count(*)::int AS "count"
              FROM "user" WHERE "id" = ANY($1::text[])`,
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
    if (count !== 0) {
      throw new Error(`${check.label} residue count was ${count}`);
    }
    process.stdout.write(
      `Change Notice Impact tasks PostgreSQL residue ${check.label}: 0\n`
    );
  }
}

async function cleanupFixture(
  pool: PostgresPool,
  cleanup: FixtureCleanup
): Promise<void> {
  const failures: Array<{ label: string; error: unknown }> = [];
  const attempt = async (label: string, operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      failures.push({ label, error });
    }
  };

  if (cleanup.noticeId && cleanup.companyId && !cleanup.noticeDeleted) {
    await attempt("delete Change Notice fixture", async () => {
      const result = await pool.query(
        `DELETE FROM "changeOrder"
         WHERE "id" = $1 AND "companyId" = $2
         RETURNING "id"`,
        [cleanup.noticeId, cleanup.companyId]
      );
      assertRowCount(result, 1, "Change Notice deletion");
      cleanup.noticeDeleted = true;
    });
  }

  if (
    cleanup.noticeId &&
    cleanup.companyId &&
    !cleanup.noticeDeleted &&
    cleanup.affectedItemIds.length > 0
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

  if (cleanup.jobId && cleanup.companyId) {
    await attempt("delete Job fixture", async () => {
      const result = await pool.query(
        `DELETE FROM "job"
         WHERE "id" = $1 AND "companyId" = $2
         RETURNING "id"`,
        [cleanup.jobId, cleanup.companyId]
      );
      assertRowCount(result, 1, "Job deletion");
    });
  }
  for (const jobId of cleanup.extraJobIds) {
    await attempt(`delete additional Job fixture ${jobId}`, async () => {
      const result = await pool.query(
        `DELETE FROM "job"
         WHERE "id" = $1 AND "companyId" = $2
         RETURNING "id"`,
        [jobId, cleanup.companyId]
      );
      assertRowCount(result, 1, "additional Job deletion");
    });
  }
  for (const methodId of cleanup.draftMakeMethodIds) {
    await attempt(`delete Change Notice draft make-method ${methodId}`, () =>
      pool.query(
        `DELETE FROM "makeMethod"
         WHERE "id" = $1 AND "companyId" = $2`,
        [methodId, cleanup.companyId]
      )
    );
  }
  for (const itemId of cleanup.draftItemIds) {
    await attempt(`delete Change Notice draft Item ${itemId}`, () =>
      pool.query(
        `DELETE FROM "item"
         WHERE "id" = $1 AND "companyId" = $2`,
        [itemId, cleanup.companyId]
      )
    );
  }
  if (cleanup.itemId && cleanup.companyId) {
    await attempt("delete item fixture", async () => {
      const result = await pool.query(
        `DELETE FROM "item"
         WHERE "id" = $1 AND "companyId" = $2
         RETURNING "id"`,
        [cleanup.itemId, cleanup.companyId]
      );
      assertRowCount(result, 1, "item deletion");
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

  await attempt("verify Change Notice Impact task residue", () =>
    verifyNoResidue(pool, cleanup)
  );

  if (failures.length > 0) {
    throw new AggregateError(
      failures.map(({ error }) => error),
      failures.map(({ label }) => label).join("; ")
    );
  }
}

async function runWithFixture(
  callback: (fixture: Fixture, markNoticeDeleted: () => void) => Promise<void>
): Promise<void> {
  const pool = requireReaderPool();
  const cleanup = makeCleanupState();
  const failures: unknown[] = [];
  try {
    const fixture = await createFixture(
      pool,
      cleanup,
      `impact-tasks-${randomBytes(12).toString("hex")}`
    );
    await callback(fixture, () => {
      cleanup.noticeDeleted = true;
    });
  } catch (error) {
    failures.push(error);
  }
  try {
    await cleanupFixture(pool, cleanup);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Change Notice Impact task fixture failed"
    );
  }
}

describe("Change Notice Impact tasks and deletion (real PostgreSQL)", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error(
        "Change Notice Impact tasks PostgreSQL setup failed: SUPABASE_DB_URL is absent or still the unit-test placeholder."
      );
    }
    const configuredTarget = requireLocalDatabaseTarget(testDatabaseUrl);
    const repositoryDatabaseUrl = readEnvValue(
      resolve(repositoryRoot, ".env.local"),
      "SUPABASE_DB_URL"
    );
    if (!repositoryDatabaseUrl) {
      throw new Error(
        "Change Notice Impact tasks PostgreSQL setup failed: the current worktree .env.local database target is unavailable."
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
    await assertDatabaseConnection(readerPool, configuredTarget);

    const impactModule = await import("./items.service");
    createChangeNoticeImpactTask = impactModule.createChangeNoticeImpactTask;
    linkChangeNoticeImpactTask = impactModule.linkChangeNoticeImpactTask;
    unlinkChangeNoticeImpactTask = impactModule.unlinkChangeNoticeImpactTask;
    designateChangeNoticeImpactTask =
      impactModule.designateChangeNoticeImpactTask;
    writeChangeNoticeImpactDecision =
      impactModule.writeChangeNoticeImpactDecision;
    deleteChangeNotice = impactModule.deleteChangeNotice;
    writerDb = getPostgresClient(requireWriterPool(), PostgresDriver);
  });

  afterAll(async () => {
    const failures: unknown[] = [];
    const pools = [readerPool, writerPool, failurePool].filter(
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
        "Change Notice Impact tasks PostgreSQL teardown failed"
      );
    }
  });

  it("bootstraps an Impact task, rolls back after its Task linked history insert, and retries cleanly", async () => {
    await runWithFixture(async (fixture) => {
      const before = await readImpactState(fixture);
      expect(before).toEqual({
        decisions: [],
        tasks: [],
        links: [],
        history: []
      });
      expect(await readImpactCounts(fixture)).toEqual({
        changeNotice: 1,
        affectedItem: 1,
        decision: 0,
        provenance: 0,
        link: 0,
        history: 0,
        actionTask: 0
      });

      const failure = makeFailOnceTaskLinkedHistoryDriver();
      const failureDb = getPostgresClient(requireFailurePool(), failure.driver);
      const failed = await createChangeNoticeImpactTask(
        failureDb,
        makeBootstrapTaskInput(fixture)
      );
      expect(failed).toEqual({
        data: null,
        error: { message: "Injected Task linked history failure" }
      });
      expect(failure.didMatch()).toBe(true);
      expect(await readImpactState(fixture)).toEqual(before);
      expect(await readImpactCounts(fixture)).toEqual({
        changeNotice: 1,
        affectedItem: 1,
        decision: 0,
        provenance: 0,
        link: 0,
        history: 0,
        actionTask: 0
      });

      const retried = await createChangeNoticeImpactTask(
        requireWriterDb(),
        makeBootstrapTaskInput(fixture)
      );
      expect(retried).toMatchObject({
        error: null,
        data: {
          decisionCreated: true,
          taskOrigin: "Impact follow-up",
          status: "Pending"
        }
      });
      if (!retried.data) throw new Error("Retried Impact task was not created");
      recordActionTask(fixture, retried.data.actionTaskId);

      const after = await readImpactState(fixture);
      expect(after.decisions).toHaveLength(1);
      expect(after.decisions[0]).toMatchObject({
        targetId: fixture.jobId,
        decisionStatus: "Action required",
        noActionReasonCode: null,
        revision: 1
      });
      expect(after.tasks).toHaveLength(1);
      expect(after.tasks[0]).toMatchObject({
        id: retried.data.actionTaskId,
        name: "Confirm operational cut-in",
        status: "Pending",
        taskOrigin: "Impact follow-up"
      });
      expect(after.links).toEqual([
        {
          decisionId: retried.data.decisionId,
          actionTaskId: retried.data.actionTaskId
        }
      ]);
      expect(after.history).toHaveLength(3);
      expect(after.history.map((event) => event.eventType).sort()).toEqual([
        "Decision created",
        "Provenance started",
        "Task linked"
      ]);
      expect(after.history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            decisionId: retried.data.decisionId,
            targetId: fixture.jobId,
            eventType: "Task linked",
            relatedActionTaskId: retried.data.actionTaskId,
            previousStatus: null,
            newStatus: null,
            createdBy: fixture.primaryUserId
          })
        ])
      );
      expect(await readImpactCounts(fixture)).toEqual({
        changeNotice: 1,
        affectedItem: 1,
        decision: 1,
        provenance: 1,
        link: 1,
        history: 3,
        actionTask: 1
      });
    });
  });

  it("preserves the task origin after unlinking one of two decision relationships", async () => {
    await runWithFixture(async (fixture) => {
      const db = requireWriterDb();
      const decisionId = await createInitialDecision(fixture, db);
      const secondJobId = await insertAdditionalJob(fixture, "second-target");
      const secondDecision = await writeChangeNoticeImpactDecision(
        db,
        makeDecisionInput(fixture, { targetId: secondJobId })
      );
      expect(secondDecision).toMatchObject({
        error: null,
        data: {
          operation: "createDecision",
          decision: {
            targetType: "job",
            targetId: secondJobId,
            decisionStatus: "Action required",
            revision: 1
          }
        }
      });
      if (!secondDecision.data) {
        throw new Error("Second Impact decision was not created");
      }
      const secondDecisionId = secondDecision.data.decision.id;
      const ordinaryTaskId = await insertOrdinaryTask(
        fixture,
        "Existing ordinary task"
      );
      const beforeLink = await readImpactState(fixture);
      expect(beforeLink.tasks).toEqual([
        expect.objectContaining({
          id: ordinaryTaskId,
          status: "Pending",
          taskOrigin: "Manual"
        })
      ]);
      const expectedDecisionConclusions = structuredClone(beforeLink.decisions);
      const initialHistory = structuredClone(beforeLink.history);
      const relationshipEventTypes = new Set([
        "Task linked",
        "Task unlinked",
        "Task designated as Impact follow-up"
      ]);
      const relationship = makeRelationshipInput(
        fixture,
        decisionId,
        ordinaryTaskId
      );
      const secondRelationship = makeRelationshipInput(
        fixture,
        secondDecisionId,
        ordinaryTaskId,
        { targetId: secondJobId }
      );

      const linked = await linkChangeNoticeImpactTask(db, relationship);
      expect(linked).toEqual({
        data: { decisionId, actionTaskId: ordinaryTaskId, changed: true },
        error: null
      });
      const afterLink = await readImpactState(fixture);
      expect(afterLink.decisions).toEqual(expectedDecisionConclusions);
      expect(afterLink.tasks[0]?.taskOrigin).toBe("Manual");
      expect(afterLink.links).toEqual([
        { decisionId, actionTaskId: ordinaryTaskId }
      ]);
      expect(afterLink.history).toHaveLength(initialHistory.length + 1);
      expect(
        afterLink.history.filter((event) =>
          relationshipEventTypes.has(event.eventType)
        )
      ).toEqual([
        expect.objectContaining({
          decisionId,
          relatedActionTaskId: ordinaryTaskId,
          eventType: "Task linked",
          createdBy: fixture.secondaryUserId
        })
      ]);
      expect(
        afterLink.history.filter(
          (event) => !relationshipEventTypes.has(event.eventType)
        )
      ).toEqual(initialHistory);

      const duplicateLink = await linkChangeNoticeImpactTask(db, relationship);
      expect(duplicateLink).toEqual({
        data: { decisionId, actionTaskId: ordinaryTaskId, changed: false },
        error: null
      });
      expect(await readImpactState(fixture)).toEqual(afterLink);

      const secondLinked = await linkChangeNoticeImpactTask(
        db,
        secondRelationship
      );
      expect(secondLinked).toEqual({
        data: {
          decisionId: secondDecisionId,
          actionTaskId: ordinaryTaskId,
          changed: true
        },
        error: null
      });
      const afterSecondLink = await readImpactState(fixture);
      const bothLinks = [
        { decisionId, actionTaskId: ordinaryTaskId },
        { decisionId: secondDecisionId, actionTaskId: ordinaryTaskId }
      ].sort((left, right) => left.decisionId.localeCompare(right.decisionId));
      expect(afterSecondLink.decisions).toEqual(expectedDecisionConclusions);
      expect(afterSecondLink.tasks[0]?.taskOrigin).toBe("Manual");
      expect(afterSecondLink.links).toEqual(bothLinks);
      expect(afterSecondLink.history).toHaveLength(initialHistory.length + 2);
      expect(
        afterSecondLink.history.filter((event) =>
          relationshipEventTypes.has(event.eventType)
        )
      ).toEqual([
        expect.objectContaining({
          decisionId,
          relatedActionTaskId: ordinaryTaskId,
          eventType: "Task linked",
          createdBy: fixture.secondaryUserId
        }),
        expect.objectContaining({
          decisionId: secondDecisionId,
          relatedActionTaskId: ordinaryTaskId,
          eventType: "Task linked",
          createdBy: fixture.secondaryUserId
        })
      ]);
      expect(
        afterSecondLink.history.filter(
          (event) => !relationshipEventTypes.has(event.eventType)
        )
      ).toEqual(initialHistory);

      const designated = await designateChangeNoticeImpactTask(
        db,
        relationship
      );
      expect(designated).toEqual({
        data: {
          decisionId,
          actionTaskId: ordinaryTaskId,
          previousTaskOrigin: "Manual",
          taskOrigin: "Impact follow-up",
          changed: true
        },
        error: null
      });
      const afterDesignation = await readImpactState(fixture);
      expect(afterDesignation.decisions).toEqual(expectedDecisionConclusions);
      expect(afterDesignation.tasks[0]?.taskOrigin).toBe("Impact follow-up");
      expect(afterDesignation.links).toEqual(bothLinks);
      expect(afterDesignation.history).toHaveLength(initialHistory.length + 3);
      expect(
        afterDesignation.history.filter((event) =>
          relationshipEventTypes.has(event.eventType)
        )
      ).toEqual([
        expect.objectContaining({
          decisionId,
          relatedActionTaskId: ordinaryTaskId,
          eventType: "Task linked",
          createdBy: fixture.secondaryUserId
        }),
        expect.objectContaining({
          decisionId: secondDecisionId,
          relatedActionTaskId: ordinaryTaskId,
          eventType: "Task linked",
          createdBy: fixture.secondaryUserId
        }),
        expect.objectContaining({
          decisionId,
          relatedActionTaskId: ordinaryTaskId,
          eventType: "Task designated as Impact follow-up",
          rationale: "Task origin changed from Manual to Impact follow-up",
          createdBy: fixture.secondaryUserId
        })
      ]);
      expect(
        afterDesignation.history.filter(
          (event) => !relationshipEventTypes.has(event.eventType)
        )
      ).toEqual(initialHistory);

      const unlinked = await unlinkChangeNoticeImpactTask(db, relationship);
      expect(unlinked).toEqual({
        data: { decisionId, actionTaskId: ordinaryTaskId, changed: true },
        error: null
      });
      const afterUnlink = await readImpactState(fixture);
      expect(afterUnlink.decisions).toEqual(expectedDecisionConclusions);
      expect(afterUnlink.links).toEqual([
        { decisionId: secondDecisionId, actionTaskId: ordinaryTaskId }
      ]);
      expect(afterUnlink.tasks[0]?.taskOrigin).toBe("Impact follow-up");
      expect(afterUnlink.history).toHaveLength(initialHistory.length + 4);
      expect(
        afterUnlink.history.filter((event) =>
          relationshipEventTypes.has(event.eventType)
        )
      ).toEqual([
        expect.objectContaining({
          decisionId,
          relatedActionTaskId: ordinaryTaskId,
          eventType: "Task linked",
          createdBy: fixture.secondaryUserId
        }),
        expect.objectContaining({
          decisionId: secondDecisionId,
          relatedActionTaskId: ordinaryTaskId,
          eventType: "Task linked",
          createdBy: fixture.secondaryUserId
        }),
        expect.objectContaining({
          decisionId,
          relatedActionTaskId: ordinaryTaskId,
          eventType: "Task designated as Impact follow-up",
          rationale: "Task origin changed from Manual to Impact follow-up",
          createdBy: fixture.secondaryUserId
        }),
        expect.objectContaining({
          decisionId,
          relatedActionTaskId: ordinaryTaskId,
          eventType: "Task unlinked",
          createdBy: fixture.secondaryUserId
        })
      ]);
      expect(
        afterUnlink.history.filter(
          (event) => !relationshipEventTypes.has(event.eventType)
        )
      ).toEqual(initialHistory);

      const duplicateUnlink = await unlinkChangeNoticeImpactTask(
        db,
        relationship
      );
      expect(duplicateUnlink).toEqual({
        data: { decisionId, actionTaskId: ordinaryTaskId, changed: false },
        error: null
      });
      expect(await readImpactState(fixture)).toEqual(afterUnlink);

      const repeatedDesignation = await designateChangeNoticeImpactTask(
        db,
        secondRelationship
      );
      expect(repeatedDesignation).toEqual({
        data: {
          decisionId: secondDecisionId,
          actionTaskId: ordinaryTaskId,
          previousTaskOrigin: "Impact follow-up",
          taskOrigin: "Impact follow-up",
          changed: false
        },
        error: null
      });
      const afterRepeatedDesignation = await readImpactState(fixture);
      expect(afterRepeatedDesignation).toEqual(afterUnlink);
    });
  });

  it("requires all linked Impact tasks to be terminal before explicit resolution", async () => {
    await runWithFixture(async (fixture) => {
      const db = requireWriterDb();
      const decisionId = await createInitialDecision(fixture, db);
      const firstTask = await createChangeNoticeImpactTask(
        db,
        makeTaskCreateInput(fixture, decisionId, {
          task: { name: "Complete production review" }
        })
      );
      const secondTask = await createChangeNoticeImpactTask(
        db,
        makeTaskCreateInput(fixture, decisionId, {
          task: { name: "Confirm supplier handoff" }
        })
      );
      expect(firstTask.error).toBeNull();
      expect(secondTask.error).toBeNull();
      if (!firstTask.data || !secondTask.data) {
        throw new Error("Resolution prerequisite tasks were not created");
      }
      recordActionTask(fixture, firstTask.data.actionTaskId);
      recordActionTask(fixture, secondTask.data.actionTaskId);
      await updateTaskStatus(fixture, firstTask.data.actionTaskId, "Completed");

      const beforeBlockedResolution = await readImpactState(fixture);
      expect(beforeBlockedResolution.decisions[0]).toMatchObject({
        decisionStatus: "Action required",
        revision: 1
      });
      expect(beforeBlockedResolution.tasks.map((task) => task.status)).toEqual([
        "Completed",
        "Pending"
      ]);

      const blocked = await writeChangeNoticeImpactDecision(
        db,
        makeDecisionInput(fixture, {
          decisionStatus: "Resolved",
          resolutionNote: "The operational intervention is complete.",
          expectedRevision: 1
        })
      );
      expect(blocked).toEqual({
        data: null,
        error: {
          message:
            "All linked Impact tasks must be Completed or Skipped before resolution."
        }
      });
      expect(await readImpactState(fixture)).toEqual(beforeBlockedResolution);

      await updateTaskStatus(fixture, secondTask.data.actionTaskId, "Skipped");
      const beforeExplicitResolution = await readImpactState(fixture);
      expect(beforeExplicitResolution.decisions[0]?.decisionStatus).toBe(
        "Action required"
      );
      expect(beforeExplicitResolution.tasks.map((task) => task.status)).toEqual(
        ["Completed", "Skipped"]
      );
      expect(
        beforeExplicitResolution.history.filter(
          (event) => event.eventType === "Decision resolved"
        )
      ).toHaveLength(0);

      const resolved = await writeChangeNoticeImpactDecision(
        db,
        makeDecisionInput(fixture, {
          decisionStatus: "Resolved",
          resolutionNote: "The operational intervention is complete.",
          expectedRevision: 1,
          userId: fixture.secondaryUserId
        })
      );
      expect(resolved).toMatchObject({
        error: null,
        data: {
          operation: "resolveActionRequired",
          decision: {
            id: decisionId,
            decisionStatus: "Resolved",
            revision: 2,
            resolutionNote: "The operational intervention is complete."
          }
        }
      });
      const after = await readImpactState(fixture);
      expect(after.decisions[0]).toMatchObject({
        id: decisionId,
        decisionStatus: "Resolved",
        revision: 2,
        resolutionNote: "The operational intervention is complete."
      });
      expect(after.tasks.map((task) => task.status)).toEqual([
        "Completed",
        "Skipped"
      ]);
      expect(after.links).toHaveLength(2);
      expect(
        after.history.filter((event) => event.eventType === "Decision resolved")
      ).toHaveLength(1);
      expect(
        after.history.filter((event) => event.eventType === "Task linked")
      ).toHaveLength(2);
    });
  });

  it("deletes a Change Notice and cleans referenced Draft Items and methods", async () => {
    await runWithFixture(async (fixture, markNoticeDeleted) => {
      const db = requireWriterDb();
      const decisionId = await createInitialDecision(fixture, db);
      const task = await createChangeNoticeImpactTask(
        db,
        makeTaskCreateInput(fixture, decisionId)
      );
      expect(task.error).toBeNull();
      if (!task.data) throw new Error("Cascade task was not created");
      recordActionTask(fixture, task.data.actionTaskId);
      const draftReferences = await createDraftReferences(fixture);
      const beforeDraftState = await readDraftReferenceState(
        fixture,
        draftReferences
      );
      expect(beforeDraftState.affectedItems).toHaveLength(2);
      expect(beforeDraftState.affectedItems).toEqual(
        expect.arrayContaining([
          {
            id: fixture.affectedItemId,
            changeOrderId: fixture.noticeId,
            itemId: fixture.itemId,
            draftMakeMethodId: draftReferences.standaloneDraftMethodId,
            newItemId: null,
            companyId: fixture.companyId
          },
          {
            id: draftReferences.affectedItemId,
            changeOrderId: fixture.noticeId,
            itemId: draftReferences.draftItemId,
            draftMakeMethodId: draftReferences.draftItemMethodId,
            newItemId: draftReferences.draftItemId,
            companyId: fixture.companyId
          }
        ])
      );
      expect(beforeDraftState.draftItem).toEqual({
        id: draftReferences.draftItemId,
        companyId: fixture.companyId,
        changeOrderId: fixture.noticeId,
        active: false,
        revisionStatus: "Design"
      });
      expect(beforeDraftState.makeMethods).toHaveLength(2);
      expect(beforeDraftState.makeMethods).toEqual(
        expect.arrayContaining([
          {
            id: draftReferences.draftItemMethodId,
            itemId: draftReferences.draftItemId,
            companyId: fixture.companyId,
            changeOrderId: fixture.noticeId,
            status: "Draft",
            version: 1
          },
          {
            id: draftReferences.standaloneDraftMethodId,
            itemId: fixture.itemId,
            companyId: fixture.companyId,
            changeOrderId: fixture.noticeId,
            status: "Draft",
            version: 2
          }
        ])
      );

      const before = await readImpactCounts(fixture);
      expect(before).toEqual({
        changeNotice: 1,
        affectedItem: 1,
        decision: 1,
        provenance: 1,
        link: 1,
        history: 3,
        actionTask: 1
      });

      const deleted = await deleteChangeNotice(
        db,
        fixture.noticeId,
        fixture.companyId
      );
      expect(deleted).toEqual({ data: null, error: null });
      markNoticeDeleted();

      expect(await readImpactCounts(fixture)).toEqual({
        changeNotice: 0,
        affectedItem: 0,
        decision: 0,
        provenance: 0,
        link: 0,
        history: 0,
        actionTask: 0
      });
      expect(await readImpactState(fixture)).toEqual({
        decisions: [],
        tasks: [],
        links: [],
        history: []
      });
      expect(await readDraftReferenceState(fixture, draftReferences)).toEqual({
        affectedItems: [],
        draftItem: null,
        makeMethods: []
      });
      expect(await readSourceCounts(fixture)).toEqual({ item: 1, job: 1 });
    });
  });

  it("rolls back Draft Item and method cleanup after a parent-delete failure", async () => {
    await runWithFixture(async (fixture, markNoticeDeleted) => {
      const db = requireWriterDb();
      const decisionId = await createInitialDecision(fixture, db);
      const task = await createChangeNoticeImpactTask(
        db,
        makeTaskCreateInput(fixture, decisionId)
      );
      expect(task.error).toBeNull();
      if (!task.data) throw new Error("Rollback task was not created");
      recordActionTask(fixture, task.data.actionTaskId);
      const draftReferences = await createDraftReferences(fixture);
      const beforeDraftState = await readDraftReferenceState(
        fixture,
        draftReferences
      );
      expect(beforeDraftState.affectedItems).toHaveLength(2);
      expect(beforeDraftState.draftItem).toEqual({
        id: draftReferences.draftItemId,
        companyId: fixture.companyId,
        changeOrderId: fixture.noticeId,
        active: false,
        revisionStatus: "Design"
      });
      expect(beforeDraftState.makeMethods).toHaveLength(2);
      expect(
        beforeDraftState.makeMethods.every(
          (method) =>
            method.companyId === fixture.companyId &&
            method.changeOrderId === fixture.noticeId &&
            method.status === "Draft"
        )
      ).toBe(true);

      const before = await readImpactState(fixture);
      const beforeCounts = await readImpactCounts(fixture);
      const failure = makeFailOnceParentDeleteDriver();
      const failureDb = getPostgresClient(requireFailurePool(), failure.driver);
      const failed = await deleteChangeNotice(
        failureDb,
        fixture.noticeId,
        fixture.companyId
      );
      expect(failed).toEqual({
        data: null,
        error: { message: "Injected parent delete failure" }
      });
      expect(failure.didMatch()).toBe(true);
      expect(await readImpactState(fixture)).toEqual(before);
      expect(await readImpactCounts(fixture)).toEqual(beforeCounts);
      expect(await readDraftReferenceState(fixture, draftReferences)).toEqual(
        beforeDraftState
      );
      expect(await readSourceCounts(fixture)).toEqual({ item: 1, job: 1 });

      const retried = await deleteChangeNotice(
        db,
        fixture.noticeId,
        fixture.companyId
      );
      expect(retried).toEqual({ data: null, error: null });
      markNoticeDeleted();
      expect(await readImpactCounts(fixture)).toEqual({
        changeNotice: 0,
        affectedItem: 0,
        decision: 0,
        provenance: 0,
        link: 0,
        history: 0,
        actionTask: 0
      });
      expect(await readImpactState(fixture)).toEqual({
        decisions: [],
        tasks: [],
        links: [],
        history: []
      });
      expect(await readDraftReferenceState(fixture, draftReferences)).toEqual({
        affectedItems: [],
        draftItem: null,
        makeMethods: []
      });
      expect(await readSourceCounts(fixture)).toEqual({ item: 1, job: 1 });
    });
  });
});
