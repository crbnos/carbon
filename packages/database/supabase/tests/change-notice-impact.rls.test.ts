import { createHash, createHmac, randomBytes } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

type ApiResult = { status: number; body: unknown };

type FixtureIds = {
  companies: string[];
  notices: string[];
  decisions: Array<[string, string]>;
  provenance: Array<[string, string]>;
  history: Array<[string, string]>;
  tasks: string[];
  links: Array<[string, string, string]>;
  apiKeys: string[];
  employeeMemberships: Array<[string, string]>;
  employeeRows: Array<[string, string]>;
  employeeTypes: Array<[string, string]>;
  employeeGroups: Array<[string, string | null]>;
  groupMemberships: number[];
  authUsers: string[];
  publicUsers: string[];
  generatedCompanyTables: string[];
};

const testDirectory = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  loadDotenv({ path: resolve(testDirectory, "../../../..", ".env.local") });
  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_DB_URL ||
    !env.SUPABASE_ANON_KEY ||
    !env.SUPABASE_JWT_SECRET ||
    !env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error("Expected Carbon Supabase environment in process.env or .env.local");
  }
  return env as {
    SUPABASE_URL: string;
    SUPABASE_DB_URL: string;
    SUPABASE_ANON_KEY: string;
    SUPABASE_JWT_SECRET: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
  };
}

const env = loadEnv();
const apiBase = env.SUPABASE_URL.replace(/\/$/, "");
const userId = "system";
const prefix = `impact-rls-${randomBytes(12).toString("hex")}`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function request(
  key: string,
  table: string,
  method: string,
  query = "",
  body?: Record<string, unknown>
): Promise<ApiResult> {
  const response = await fetch(`${apiBase}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      "carbon-key": key,
      "content-type": "application/json",
      Prefer: "return=representation"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

function rows(result: ApiResult): unknown[] {
  return Array.isArray(result.body) ? result.body : [];
}

function assert(name: string, condition: boolean, detail?: unknown): void {
  if (!condition) {
    throw new Error(`${name}: ${detail ? JSON.stringify(detail) : "assertion failed"}`);
  }
  console.log(`PASS ${name}`);
}

function isDenied(result: ApiResult): boolean {
  return (result.status >= 400 && result.status < 500) ||
    (result.status === 200 && rows(result).length === 0);
}

function hasNoVisibleMutation(result: ApiResult): boolean {
  return result.status >= 400 || rows(result).length === 0;
}

// Mirrors Carbon's getUserScopedClient JWT claims without importing the full app
// environment (which requires unrelated ERP secrets in this DB package test).
function getEmployeeJwt(userId: string): string {
  const encode = (value: Record<string, string>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ sub: userId, aud: "authenticated", role: "authenticated" });
  const signature = createHmac("sha256", env.SUPABASE_JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function employeeRequest(
  jwt: string,
  table: string,
  method: string,
  query = "",
  body?: Record<string, unknown>
): Promise<ApiResult> {
  const response = await fetch(`${apiBase}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
      Prefer: "return=representation"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

type EmployeePermissionOverrides = {
  partsView: boolean;
  partsUpdate: boolean;
  purchasingView: boolean;
  productionView: boolean;
};

async function setEmployeePermissions(
  db: Client,
  userId: string,
  companyId: string | string[],
  overrides: EmployeePermissionOverrides
): Promise<void> {
  const companyIds = Array.isArray(companyId) ? companyId : [companyId];
  await db.query(
    `UPDATE "userPermission"
     SET "permissions" = "permissions" || $1::jsonb
     WHERE "id" = $2`,
    [
      JSON.stringify({
        parts_view: overrides.partsView ? companyIds : [],
        parts_update: overrides.partsUpdate ? companyIds : [],
        purchasing_view: overrides.purchasingView ? companyIds : [],
        production_view: overrides.productionView ? companyIds : []
      }),
      userId
    ]
  );
}

async function runEmployeeSessionChecks(
  db: Client,
  companyId: string,
  userId: string,
  noticeId: string,
  poDecisionId: string,
  jobDecisionId: string,
  materialDecisionId: string,
  taskId: string
): Promise<void> {
  const employeeJwt = getEmployeeJwt(userId);
  const decision = (id: string) =>
    `?companyId=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(id)}&select=id`;
  const childRows = (decisionId: string) =>
    `?companyId=eq.${encodeURIComponent(companyId)}&decisionId=eq.${encodeURIComponent(decisionId)}&select=id`;
  const taskLink = (decisionId: string) =>
    `?companyId=eq.${encodeURIComponent(companyId)}&decisionId=eq.${encodeURIComponent(decisionId)}&actionTaskId=eq.${encodeURIComponent(taskId)}&select=decisionId,actionTaskId,companyId`;
  const childTables = [
    ["changeOrderImpactDecisionAffectedItem", "provenance"],
    ["changeOrderImpactDecisionActionTask", "task link"],
    ["changeOrderImpactDecisionHistory", "history"]
  ] as const;
  const assertEmployeeImpactChildren = async (
    sourceLabel: string,
    decisionId: string,
    expectedRows: number
  ): Promise<void> => {
    for (const [table, childLabel] of childTables) {
      const query = table === "changeOrderImpactDecisionActionTask" ? taskLink(decisionId) : childRows(decisionId);
      const childRead = await employeeRequest(employeeJwt, table, "GET", query);
      assert(
        `Employee ${sourceLabel} ${childLabel} ${expectedRows === 1 ? "can" : "cannot"} read`,
        childRead.status === 200 && rows(childRead).length === expectedRows
      );
    }
  };

  await setEmployeePermissions(db, userId, companyId, {
    partsView: true,
    partsUpdate: false,
    purchasingView: true,
    productionView: false
  });
  let read = await employeeRequest(employeeJwt, "changeOrderImpactDecision", "GET", decision(poDecisionId));
  assert("Employee PO parts_view + purchasing_view can read", read.status === 200 && rows(read).length === 1);
  await assertEmployeeImpactChildren("PO", poDecisionId, 1);
  await assertEmployeeImpactChildren("Job", jobDecisionId, 0);

  await setEmployeePermissions(db, userId, companyId, {
    partsView: true,
    partsUpdate: false,
    purchasingView: false,
    productionView: false
  });
  read = await employeeRequest(employeeJwt, "changeOrderImpactDecision", "GET", decision(poDecisionId));
  assert("Employee PO without purchasing_view cannot read", read.status === 200 && rows(read).length === 0);
  await assertEmployeeImpactChildren("PO without purchasing_view", poDecisionId, 0);

  await setEmployeePermissions(db, userId, companyId, {
    partsView: true,
    partsUpdate: false,
    purchasingView: false,
    productionView: true
  });
  const jobRead = await employeeRequest(employeeJwt, "changeOrderImpactDecision", "GET", decision(jobDecisionId));
  const materialRead = await employeeRequest(
    employeeJwt,
    "changeOrderImpactDecision",
    "GET",
    decision(materialDecisionId)
  );
  assert("Employee Job parts_view + production_view can read", jobRead.status === 200 && rows(jobRead).length === 1);
  assert(
    "Employee Job Material production visibility can read",
    materialRead.status === 200 && rows(materialRead).length === 1
  );
  await assertEmployeeImpactChildren("Job", jobDecisionId, 1);
  await assertEmployeeImpactChildren("Job Material", materialDecisionId, 1);
  await assertEmployeeImpactChildren("PO with production_view only", poDecisionId, 0);

  await setEmployeePermissions(db, userId, companyId, {
    partsView: true,
    partsUpdate: false,
    purchasingView: false,
    productionView: false
  });
  const hiddenJob = await employeeRequest(employeeJwt, "changeOrderImpactDecision", "GET", decision(jobDecisionId));
  const hiddenMaterial = await employeeRequest(
    employeeJwt,
    "changeOrderImpactDecision",
    "GET",
    decision(materialDecisionId)
  );
  assert("Employee Job without production_view cannot read", hiddenJob.status === 200 && rows(hiddenJob).length === 0);
  assert(
    "Employee Job Material without production_view cannot read",
    hiddenMaterial.status === 200 && rows(hiddenMaterial).length === 0
  );
  await assertEmployeeImpactChildren("Job without production_view", jobDecisionId, 0);
  await assertEmployeeImpactChildren("Job Material without production_view", materialDecisionId, 0);

  await setEmployeePermissions(db, userId, companyId, {
    partsView: true,
    partsUpdate: true,
    purchasingView: true,
    productionView: true
  });
  const employeeInsertTargetId = `employee-direct-${randomBytes(8).toString("hex")}`;
  const directInsert = await employeeRequest(
    employeeJwt,
    "changeOrderImpactDecision",
    "POST",
    "",
    {
      companyId,
      changeNoticeId: noticeId,
      targetType: "purchaseOrderLine",
      targetId: employeeInsertTargetId,
      decisionStatus: "Action required",
      assessmentSnapshot: {},
      assessedBy: userId,
      createdBy: userId
    }
  );
  const employeeDirectDecisionCount = (
    await db.query(
      `SELECT count(*)::int AS count FROM "changeOrderImpactDecision"
       WHERE "companyId" = $1 AND "targetId" = $2`,
      [companyId, employeeInsertTargetId]
    )
  ).rows[0].count;
  assert(
    "Employee direct Impact INSERT is denied",
    hasNoVisibleMutation(directInsert) && employeeDirectDecisionCount === 0
  );

  const beforeDecision = (
    await db.query(
      `SELECT "decisionStatus", "revision" FROM "changeOrderImpactDecision" WHERE "id" = $1`,
      [poDecisionId]
    )
  ).rows[0];
  const directUpdate = await employeeRequest(
    employeeJwt,
    "changeOrderImpactDecision",
    "PATCH",
    `?id=eq.${encodeURIComponent(poDecisionId)}`,
    { decisionStatus: "Resolved", revision: 99 }
  );
  const afterDecision = (
    await db.query(
      `SELECT "decisionStatus", "revision" FROM "changeOrderImpactDecision" WHERE "id" = $1`,
      [poDecisionId]
    )
  ).rows[0];
  assert(
    "Employee direct Impact UPDATE is denied",
    hasNoVisibleMutation(directUpdate) &&
      afterDecision.decisionStatus === beforeDecision.decisionStatus &&
      afterDecision.revision === beforeDecision.revision
  );

  const directOrigin = await employeeRequest(
    employeeJwt,
    "changeOrderActionTask",
    "PATCH",
    `?id=eq.${encodeURIComponent(taskId)}`,
    { taskOrigin: "Impact follow-up" }
  );
  const originAfterDirectPromotion = (
    await db.query(`SELECT "taskOrigin" FROM "changeOrderActionTask" WHERE "id" = $1`, [taskId])
  ).rows[0].taskOrigin;
  assert("Employee direct taskOrigin promotion is denied", directOrigin.status >= 400 && originAfterDirectPromotion === "Manual");

  const ordinaryTaskUpdate = await employeeRequest(
    employeeJwt,
    "changeOrderActionTask",
    "PATCH",
    `?id=eq.${encodeURIComponent(taskId)}`,
    { name: "Employee ordinary task update" }
  );
  const ordinaryTaskAfterUpdate = (
    await db.query(`SELECT "name", "taskOrigin" FROM "changeOrderActionTask" WHERE "id" = $1`, [taskId])
  ).rows[0];
  assert(
    "Employee ordinary task update remains allowed",
    ordinaryTaskUpdate.status === 200 &&
      rows(ordinaryTaskUpdate).length === 1 &&
      ordinaryTaskAfterUpdate.name === "Employee ordinary task update" &&
      ordinaryTaskAfterUpdate.taskOrigin === "Manual"
  );
}

async function insertApiKey(
  db: Client,
  fixture: FixtureIds,
  name: string,
  companyId: string,
  scopes: Record<string, string[]>
): Promise<string> {
  const raw = `${prefix}-${name}-${randomBytes(12).toString("hex")}`;
  const result = await db.query(
    `INSERT INTO "apiKey" ("name", "companyId", "createdBy", "keyHash", "keyPreview", "scopes")
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING "id"`,
    [name, companyId, userId, hash(raw), raw.slice(-8), JSON.stringify(scopes)]
  );
  fixture.apiKeys.push(result.rows[0].id);
  return raw;
}

async function insertCompany(db: Client, fixture: FixtureIds, name: string, currency: string): Promise<string> {
  const result = await db.query(
    `INSERT INTO "company" ("name", "baseCurrencyCode") VALUES ($1, $2) RETURNING "id"`,
    [name, currency]
  );
  const companyId = result.rows[0].id as string;
  fixture.companies.push(companyId);
  fixture.generatedCompanyTables.push(`searchIndex_${companyId}`, `auditLog_${companyId}`);
  return companyId;
}

async function createEmployeeFixture(
  db: Client,
  fixture: FixtureIds,
  authAdmin: SupabaseClient,
  companyIds: string[]
): Promise<string> {
  const { data, error } = await authAdmin.auth.admin.createUser({
    email: `${prefix}@carbonos.dev`,
    password: randomBytes(24).toString("base64url"),
    email_confirm: true,
    user_metadata: { name: "Impact RLS Fixture" },
    app_metadata: { role: "employee", provider: "email", providers: ["email"] }
  });
  if (error || !data.user) {
    throw new Error(`Failed to create dedicated RLS employee: ${error?.message ?? "no user returned"}`);
  }

  const employeeUserId = data.user.id;
  fixture.authUsers.push(employeeUserId);
  fixture.publicUsers.push(employeeUserId);
  fixture.employeeGroups.push([employeeUserId, null]);
  const publicUser = await db.query(`SELECT 1 FROM "user" WHERE "id" = $1`, [employeeUserId]);
  if (publicUser.rowCount !== 1) {
    throw new Error("Auth user did not create the Carbon public user row");
  }
  const identityMembership = await db.query(
    `SELECT "id" FROM "membership"
     WHERE "groupId" = $1 AND "memberUserId" = $1 AND "memberGroupId" IS NULL`,
    [employeeUserId]
  );
  if (identityMembership.rowCount !== 1) {
    throw new Error("Carbon public user did not create the identity-group membership");
  }
  fixture.groupMemberships.push(Number(identityMembership.rows[0].id));
  const permission = await db.query(`SELECT 1 FROM "userPermission" WHERE "id" = $1`, [employeeUserId]);
  if (permission.rowCount !== 1) {
    throw new Error("Auth user did not create the Carbon userPermission row");
  }

  for (const companyId of companyIds) {
    const allEmployeesGroupId = `00000000-0000-${companyId.slice(0, 4)}-${companyId.slice(4, 8)}-${companyId.slice(8, 20)}`;
    await db.query(
      `INSERT INTO "group" ("id", "name", "companyId", "isEmployeeTypeGroup")
       VALUES ($1, 'All Employees', $2, true)`,
      [allEmployeesGroupId, companyId]
    );
    fixture.employeeGroups.push([allEmployeesGroupId, companyId]);
    await db.query(
      `INSERT INTO "userToCompany" ("userId", "companyId", "role") VALUES ($1, $2, 'employee')`,
      [employeeUserId, companyId]
    );
    fixture.employeeMemberships.push([employeeUserId, companyId]);
    const employeeType = await db.query(
      `INSERT INTO "employeeType" ("name", "companyId", "protected") VALUES ($1, $2, false) RETURNING "id"`,
      [`${prefix}-employee-type`, companyId]
    );
    const employeeTypeId = employeeType.rows[0].id as string;
    fixture.employeeTypes.push([employeeTypeId, companyId]);
    fixture.employeeGroups.push([employeeTypeId, companyId]);
    const typeMembership = await db.query(
      `SELECT "id" FROM "membership"
       WHERE "groupId" = $1 AND "memberGroupId" = $2 AND "memberUserId" IS NULL`,
      [allEmployeesGroupId, employeeTypeId]
    );
    if (typeMembership.rowCount !== 1) {
      throw new Error("Employee type did not create the All Employees group membership");
    }
    fixture.groupMemberships.push(Number(typeMembership.rows[0].id));
    await db.query(
      `INSERT INTO "employee" ("id", "companyId", "employeeTypeId", "active") VALUES ($1, $2, $3, true)`,
      [employeeUserId, companyId, employeeTypeId]
    );
    fixture.employeeRows.push([employeeUserId, companyId]);
    const employeeMembership = await db.query(
      `SELECT "id" FROM "membership"
       WHERE "groupId" = $1 AND "memberUserId" = $2 AND "memberGroupId" IS NULL`,
      [employeeTypeId, employeeUserId]
    );
    if (employeeMembership.rowCount !== 1) {
      throw new Error("Employee did not create the employee-type group membership");
    }
    fixture.groupMemberships.push(Number(employeeMembership.rows[0].id));
  }

  return employeeUserId;
}

async function insertNotice(db: Client, companyId: string, name: string): Promise<string> {
  const result = await db.query(
    `INSERT INTO "changeOrder" ("changeOrderId", "name", "openDate", "companyId", "createdBy")
     VALUES ($1, $2, CURRENT_DATE, $3, $4)
     RETURNING "id"`,
    [`${prefix}-${name}`, name, companyId, userId]
  );
  return result.rows[0].id;
}

async function insertTask(
  db: Client,
  companyId: string,
  noticeId: string,
  name: string
): Promise<string> {
  const result = await db.query(
    `INSERT INTO "changeOrderActionTask" ("changeOrderId", "name", "companyId", "createdBy")
     VALUES ($1, $2, $3, $4)
     RETURNING "id"`,
    [noticeId, name, companyId, userId]
  );
  return result.rows[0].id;
}

async function insertDecision(
  db: Client,
  fixture: FixtureIds,
  companyId: string,
  noticeId: string,
  targetType: string,
  targetId: string
): Promise<string> {
  const result = await db.query(
    `INSERT INTO "changeOrderImpactDecision"
      ("companyId", "changeNoticeId", "targetType", "targetId", "decisionStatus", "assessmentSnapshot", "assessedBy", "createdBy")
     VALUES ($1, $2, $3, $4, 'Action required', '{}'::jsonb, $5, $5)
     RETURNING "id"`,
    [companyId, noticeId, targetType, targetId, userId]
  );
  fixture.decisions.push([result.rows[0].id, companyId]);
  return result.rows[0].id;
}

async function main() {
  const db = new Client({ connectionString: env.SUPABASE_DB_URL });
  const fixture: FixtureIds = {
    companies: [],
    notices: [],
    decisions: [],
    provenance: [],
    history: [],
    tasks: [],
    links: [],
    apiKeys: [],
    employeeMemberships: [],
    employeeRows: [],
    employeeTypes: [],
    employeeGroups: [],
    groupMemberships: [],
    authUsers: [],
    publicUsers: [],
    generatedCompanyTables: []
  };
  let employeeUserId = "";
  let authAdmin: SupabaseClient | undefined;
  await db.connect();

  try {
    authAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const currency = (
      await db.query(`SELECT "code" FROM "currencyCode" LIMIT 1`)
    ).rows[0]?.code;
    if (!currency) throw new Error("local DB needs a currency fixture");
    const company = await insertCompany(db, fixture, `${prefix}-company-a`, currency);
    const otherCompany = await insertCompany(db, fixture, `${prefix}-company-b`, currency);
    employeeUserId = await createEmployeeFixture(db, fixture, authAdmin, [company, otherCompany]);
    const notice = await insertNotice(db, company, `${prefix}-primary-notice`);
    fixture.notices.push(notice);

    const poDecision = await insertDecision(
      db,
      fixture,
      company,
      notice,
      "purchaseOrderLine",
      `${prefix}-po`
    );
    const jobDecision = await insertDecision(
      db,
      fixture,
      company,
      notice,
      "job",
      `${prefix}-job`
    );
    const materialDecision = await insertDecision(
      db,
      fixture,
      company,
      notice,
      "jobMaterial",
      `${prefix}-material`
    );

    for (const [decisionId, sourceId] of [
      [poDecision, `${prefix}-po`],
      [jobDecision, `${prefix}-job`],
      [materialDecision, `${prefix}-material`]
    ]) {
      const provenance = await db.query(
        `INSERT INTO "changeOrderImpactDecisionAffectedItem"
          ("companyId", "decisionId", "affectedItemId", "affectedItemSourceId", "affectedItemLabel", "startedBy", "createdBy")
         VALUES ($1, $2, $3, $3, 'RLS fixture', $4, $4)
         RETURNING "id"`,
        [company, decisionId, `${prefix}-${sourceId}`, userId]
      );
      fixture.provenance.push([provenance.rows[0].id, company]);
      const history = await db.query(
        `INSERT INTO "changeOrderImpactDecisionHistory"
          ("companyId", "decisionId", "targetType", "targetId", "eventType", "newStatus", "newSnapshot", "createdBy")
         SELECT $1, id, "targetType", "targetId", 'Decision created', "decisionStatus", '{}'::jsonb, $3
         FROM "changeOrderImpactDecision" WHERE id = $2
         RETURNING "id"`,
        [company, decisionId, userId]
      );
      fixture.history.push([history.rows[0].id, company]);
    }

    const task = await insertTask(db, company, notice, `${prefix}-task`);
    fixture.tasks.push(task);
    const sameNoticeTask = await insertTask(db, company, notice, `${prefix}-same-notice-task`);
    fixture.tasks.push(sameNoticeTask);
    for (const decisionId of [poDecision, jobDecision, materialDecision]) {
      await db.query(
        `INSERT INTO "changeOrderImpactDecisionActionTask" ("decisionId", "actionTaskId", "companyId", "createdBy")
         VALUES ($1, $2, $3, $4)`,
        [decisionId, task, company, userId]
      );
      fixture.links.push([decisionId, task, company]);
    }

    const otherNotice = await insertNotice(db, company, `${prefix}-other-notice`);
    fixture.notices.push(otherNotice);
    const otherTask = await insertTask(db, company, otherNotice, `${prefix}-other-task`);
    fixture.tasks.push(otherTask);

    const otherCompanyNotice = await insertNotice(
      db,
      otherCompany,
      `${prefix}-other-company-notice`
    );
    fixture.notices.push(otherCompanyNotice);
    const otherCompanyTask = await insertTask(
      db,
      otherCompany,
      otherCompanyNotice,
      `${prefix}-other-company-task`
    );
    fixture.tasks.push(otherCompanyTask);
    const otherCompanyDecision = await insertDecision(
      db,
      fixture,
      otherCompany,
      otherCompanyNotice,
      "purchaseOrderLine",
      `${prefix}-other-company-po`
    );
    const sharedDecisionId = `${prefix}-shared-decision`;
    await db.query(
      `INSERT INTO "changeOrderImpactDecision"
        ("id", "companyId", "changeNoticeId", "targetType", "targetId", "decisionStatus", "assessmentSnapshot", "assessedBy", "createdBy")
       VALUES
        ($1, $2, $3, 'purchaseOrderLine', $4, 'Action required', '{}'::jsonb, $8, $8),
        ($1, $5, $6, 'job', $7, 'Action required', '{}'::jsonb, $8, $8)`,
      [
        sharedDecisionId,
        company,
        notice,
        `${prefix}-shared-po`,
        otherCompany,
        otherCompanyNotice,
        `${prefix}-shared-job`,
        userId
      ]
    );
    fixture.decisions.push([sharedDecisionId, company]);
    fixture.decisions.push([sharedDecisionId, otherCompany]);
    for (const [sharedCompanyId, label] of [
      [company, "Shared Company A provenance"],
      [otherCompany, "Shared Company B provenance"]
    ] as const) {
      const sharedProvenance = await db.query(
        `INSERT INTO "changeOrderImpactDecisionAffectedItem"
          ("companyId", "decisionId", "affectedItemId", "affectedItemSourceId", "affectedItemLabel", "startedBy", "createdBy")
         VALUES ($1, $2, $3, $3, $4, $5, $5)
         RETURNING "id"`,
        [sharedCompanyId, sharedDecisionId, `${prefix}-${sharedCompanyId === company ? "shared-a" : "shared-b"}-affected-item`, label, userId]
      );
      fixture.provenance.push([sharedProvenance.rows[0].id, sharedCompanyId]);
      const sharedHistory = await db.query(
        `INSERT INTO "changeOrderImpactDecisionHistory"
          ("companyId", "decisionId", "targetType", "targetId", "eventType", "newStatus", "newSnapshot", "createdBy")
         SELECT $1, "id", "targetType", "targetId", 'Decision created', "decisionStatus", '{}'::jsonb, $3
         FROM "changeOrderImpactDecision"
         WHERE "id" = $2 AND "companyId" = $1
         RETURNING "id"`,
        [sharedCompanyId, sharedDecisionId, userId]
      );
      fixture.history.push([sharedHistory.rows[0].id, sharedCompanyId]);
    }
    for (const [sharedCompanyId, sharedTaskId] of [
      [company, task],
      [otherCompany, otherCompanyTask]
    ] as const) {
      await db.query(
        `INSERT INTO "changeOrderImpactDecisionActionTask"
          ("decisionId", "actionTaskId", "companyId", "createdBy")
         VALUES ($1, $2, $3, $4)`,
        [sharedDecisionId, sharedTaskId, sharedCompanyId, userId]
      );
      fixture.links.push([sharedDecisionId, sharedTaskId, sharedCompanyId]);
    }

    const partsOnly = await insertApiKey(db, fixture, "parts-only", company, {
      parts_view: [company]
    });
    const poRead = await insertApiKey(db, fixture, "po-read", company, {
      parts_view: [company],
      purchasing_view: [company]
    });
    const productionRead = await insertApiKey(db, fixture, "production-read", company, {
      parts_view: [company],
      production_view: [company]
    });
    const noPartsUpdate = await insertApiKey(db, fixture, "no-parts-update", company, {
      parts_view: [company],
      purchasing_view: [company]
    });
    const noSourceView = await insertApiKey(db, fixture, "no-source-view", company, {
      parts_view: [company],
      parts_update: [company]
    });
    const full = await insertApiKey(db, fixture, "full", company, {
      parts_view: [company],
      parts_update: [company],
      purchasing_view: [company],
      production_view: [company]
    });
    const taskWriter = await insertApiKey(db, fixture, "task-writer", company, {
      parts_view: [company],
      parts_create: [company],
      parts_update: [company],
      purchasing_view: [company]
    });
    const otherProductionRead = await insertApiKey(db, fixture, "other-production-read", otherCompany, {
      parts_view: [otherCompany],
      production_view: [otherCompany]
    });

    await db.query(
      `UPDATE "changeOrderActionTask" SET "taskOrigin" = 'Impact follow-up' WHERE "id" = $1`,
      [task]
    );
    const trustedOrigin = (
      await db.query(`SELECT "taskOrigin" FROM "changeOrderActionTask" WHERE "id" = $1`, [task])
    ).rows[0]?.taskOrigin;
    assert("Trusted database path can set taskOrigin", trustedOrigin === "Impact follow-up");
    await db.query(`UPDATE "changeOrderActionTask" SET "taskOrigin" = 'Manual' WHERE "id" = $1`, [task]);

    const row = (targetType: string, targetId: string) =>
      `?companyId=eq.${encodeURIComponent(company)}&targetType=eq.${targetType}&targetId=eq.${encodeURIComponent(targetId)}&select=id`;
    const childRows = (decisionId: string) =>
      `?companyId=eq.${encodeURIComponent(company)}&decisionId=eq.${encodeURIComponent(decisionId)}&select=id`;
    const taskLink = (decisionId: string) =>
      `?companyId=eq.${encodeURIComponent(company)}&decisionId=eq.${encodeURIComponent(decisionId)}&actionTaskId=eq.${encodeURIComponent(task)}&select=decisionId,actionTaskId,companyId`;
    let result = await request(
      partsOnly,
      "changeOrderImpactDecision",
      "GET",
      row("purchaseOrderLine", `${prefix}-po`)
    );
    assert("PO with parts_view only is hidden", result.status === 200 && rows(result).length === 0);
    result = await request(
      poRead,
      "changeOrderImpactDecision",
      "GET",
      row("purchaseOrderLine", `${prefix}-po`)
    );
    assert("PO with purchasing_view is readable", result.status === 200 && rows(result).length === 1);
    for (const table of [
      "changeOrderImpactDecisionAffectedItem",
      "changeOrderImpactDecisionActionTask",
      "changeOrderImpactDecisionHistory"
    ]) {
      result = await request(partsOnly, table, "GET", table === "changeOrderImpactDecisionActionTask" ? taskLink(poDecision) : childRows(poDecision));
      assert(`${table} with parts_view only is hidden`, result.status === 200 && rows(result).length === 0);
      result = await request(poRead, table, "GET", table === "changeOrderImpactDecisionActionTask" ? taskLink(poDecision) : childRows(poDecision));
      assert(`${table} with purchasing_view is readable`, result.status === 200 && rows(result).length === 1);
    }
    result = await request(
      partsOnly,
      "changeOrderImpactDecision",
      "GET",
      row("job", `${prefix}-job`)
    );
    assert("Job with parts_view only is hidden", result.status === 200 && rows(result).length === 0);
    result = await request(
      productionRead,
      "changeOrderImpactDecision",
      "GET",
      row("job", `${prefix}-job`)
    );
    assert("Job with production_view is readable", result.status === 200 && rows(result).length === 1);
    result = await request(
      productionRead,
      "changeOrderImpactDecision",
      "GET",
      row("jobMaterial", `${prefix}-material`)
    );
    assert("Job Material with production_view is readable", result.status === 200 && rows(result).length === 1);
    for (const decisionId of [jobDecision, materialDecision]) {
      for (const table of [
        "changeOrderImpactDecisionAffectedItem",
        "changeOrderImpactDecisionHistory"
      ]) {
        result = await request(productionRead, table, "GET", childRows(decisionId));
        assert(`${table} production source row is readable`, result.status === 200 && rows(result).length === 1);
      }
      result = await request(productionRead, "changeOrderImpactDecisionActionTask", "GET", taskLink(decisionId));
      assert(`Task link for ${decisionId} is readable with production_view`, result.status === 200 && rows(result).length === 1);
      for (const table of [
        "changeOrderImpactDecisionAffectedItem",
        "changeOrderImpactDecisionActionTask",
        "changeOrderImpactDecisionHistory"
      ]) {
        const query = table === "changeOrderImpactDecisionActionTask" ? taskLink(decisionId) : childRows(decisionId);
        result = await request(partsOnly, table, "GET", query);
        assert(`${table} with parts_view only hides production rows`, result.status === 200 && rows(result).length === 0);
        result = await request(poRead, table, "GET", query);
        assert(`${table} with purchasing_view hides production rows`, result.status === 200 && rows(result).length === 0);
      }
    }
    for (const table of [
      "changeOrderImpactDecisionAffectedItem",
      "changeOrderImpactDecisionActionTask",
      "changeOrderImpactDecisionHistory"
    ]) {
      const query = table === "changeOrderImpactDecisionActionTask" ? taskLink(poDecision) : childRows(poDecision);
      result = await request(productionRead, table, "GET", query);
      assert(`${table} with production_view hides purchasing rows`, result.status === 200 && rows(result).length === 0);
    }
    result = await request(
      productionRead,
      "changeOrderImpactDecision",
      "GET",
      row("purchaseOrderLine", `${prefix}-po`)
    );
    assert("Production-only source view cannot read PO", result.status === 200 && rows(result).length === 0);

    const otherRow =
      `?companyId=eq.${encodeURIComponent(otherCompany)}&targetType=eq.job&targetId=eq.${encodeURIComponent(`${prefix}-shared-job`)}&select=id`;
    const otherChildRows = (decisionId: string) =>
      `?companyId=eq.${encodeURIComponent(otherCompany)}&decisionId=eq.${encodeURIComponent(decisionId)}&select=id`;
    const otherTaskLink =
      `?companyId=eq.${encodeURIComponent(otherCompany)}&decisionId=eq.${encodeURIComponent(sharedDecisionId)}&actionTaskId=eq.${encodeURIComponent(otherCompanyTask)}&select=decisionId,actionTaskId,companyId`;
    result = await request(otherProductionRead, "changeOrderImpactDecision", "GET", otherRow);
    assert("Company B Job with production_view is readable", result.status === 200 && rows(result).length === 1);
    for (const table of [
      "changeOrderImpactDecisionAffectedItem",
      "changeOrderImpactDecisionActionTask",
      "changeOrderImpactDecisionHistory"
    ]) {
      const query = table === "changeOrderImpactDecisionActionTask"
        ? otherTaskLink
        : otherChildRows(sharedDecisionId);
      result = await request(otherProductionRead, table, "GET", query);
      assert(`Company B ${table} with production_view is readable`, result.status === 200 && rows(result).length === 1);
    }
    result = await request(full, "changeOrderImpactDecision", "GET", otherRow);
    assert("Company A API key cannot read Company B Job", result.status === 200 && rows(result).length === 0);
    for (const table of [
      "changeOrderImpactDecisionAffectedItem",
      "changeOrderImpactDecisionActionTask",
      "changeOrderImpactDecisionHistory"
    ]) {
      const query = table === "changeOrderImpactDecisionActionTask"
        ? otherTaskLink
        : otherChildRows(sharedDecisionId);
      result = await request(full, table, "GET", query);
      assert(`Company A API key cannot read Company B ${table}`, result.status === 200 && rows(result).length === 0);
    }

    const body = {
      companyId: company,
      changeNoticeId: notice,
      targetType: "purchaseOrderLine",
      targetId: `${prefix}-write`,
      decisionStatus: "Action required",
      assessmentSnapshot: {},
      assessedBy: userId,
      createdBy: userId
    };
    result = await request(noPartsUpdate, "changeOrderImpactDecision", "POST", "", body);
    assert("Missing parts_update blocks Impact INSERT", isDenied(result));
    result = await request(noSourceView, "changeOrderImpactDecision", "POST", "", body);
    assert("Missing source view blocks Impact INSERT", isDenied(result));
    result = await request(full, "changeOrderImpactDecision", "POST", "", body);
    const directDecisionCount = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecision"
         WHERE "companyId" = $1 AND "targetId" = $2`,
        [company, body.targetId]
      )
    ).rows[0].count;
    assert("Source-authorized direct Impact INSERT is denied", hasNoVisibleMutation(result) && directDecisionCount === 0);
    result = await request(
      full,
      "changeOrderImpactDecision",
      "GET",
      `?companyId=eq.${encodeURIComponent(otherCompany)}&id=eq.${encodeURIComponent(otherCompanyDecision)}`
    );
    assert("Wrong-company Impact read is hidden", result.status === 200 && rows(result).length === 0);
    result = await request(
      full,
      "changeOrderImpactDecision",
      "POST",
      "",
      { ...body, companyId: otherCompany, changeNoticeId: otherCompanyNotice }
    );
    assert("Wrong-company Impact INSERT is blocked", isDenied(result));

    result = await request(
      noPartsUpdate,
      "changeOrderImpactDecision",
      "PATCH",
      `?id=eq.${encodeURIComponent(poDecision)}`,
      { rationale: "blocked" }
    );
    assert("Missing parts_update blocks Impact UPDATE", isDenied(result));
    result = await request(
      noSourceView,
      "changeOrderImpactDecision",
      "PATCH",
      `?id=eq.${encodeURIComponent(poDecision)}`,
      { rationale: "blocked" }
    );
    assert("Missing source view blocks Impact UPDATE", isDenied(result));
    result = await request(
      full,
      "changeOrderImpactDecision",
      "PATCH",
      `?id=eq.${encodeURIComponent(poDecision)}`,
      {
        decisionStatus: "Resolved",
        assessmentSnapshot: { directMutation: true },
        revision: 99,
        rationale: "direct mutation",
        resolutionNote: "direct mutation"
      }
    );
    const decisionAfterDirectUpdate = (
      await db.query(
        `SELECT "decisionStatus", "assessmentSnapshot", "revision", "rationale", "resolutionNote"
         FROM "changeOrderImpactDecision" WHERE "id" = $1`,
        [poDecision]
      )
    ).rows[0];
    assert(
      "Source-authorized direct Impact UPDATE is denied",
      hasNoVisibleMutation(result) &&
        decisionAfterDirectUpdate.decisionStatus === "Action required" &&
        decisionAfterDirectUpdate.assessmentSnapshot.directMutation === undefined &&
        decisionAfterDirectUpdate.revision === 1 &&
        decisionAfterDirectUpdate.rationale === null &&
        decisionAfterDirectUpdate.resolutionNote === null
    );
    result = await request(
      full,
      "changeOrderImpactDecision",
      "DELETE",
      `?id=eq.${encodeURIComponent(poDecision)}`
    );
    const decisionStillExists = (
      await db.query(`SELECT count(*)::int AS count FROM "changeOrderImpactDecision" WHERE "id" = $1`, [poDecision])
    ).rows[0].count;
    assert("Direct Impact DELETE is denied", hasNoVisibleMutation(result) && decisionStillExists === 1);

    const provenanceId = (
      await db.query(
        `SELECT "id" FROM "changeOrderImpactDecisionAffectedItem"
         WHERE "decisionId" = $1 ORDER BY "createdAt" LIMIT 1`,
        [poDecision]
      )
    ).rows[0].id;
    result = await request(taskWriter, "changeOrderImpactDecisionAffectedItem", "POST", "", {
      companyId: company,
      decisionId: poDecision,
      affectedItemId: `${prefix}-direct-provenance`,
      affectedItemSourceId: `${prefix}-direct-source`,
      affectedItemLabel: "Direct mutation",
      startedBy: userId,
      createdBy: userId
    });
    const directProvenanceCount = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecisionAffectedItem"
         WHERE "affectedItemId" = $1`,
        [`${prefix}-direct-provenance`]
      )
    ).rows[0].count;
    assert("Direct provenance INSERT is denied", hasNoVisibleMutation(result) && directProvenanceCount === 0);
    result = await request(
      taskWriter,
      "changeOrderImpactDecisionAffectedItem",
      "PATCH",
      `?id=eq.${encodeURIComponent(provenanceId)}`,
      { affectedItemLabel: "Direct mutation" }
    );
    const provenanceAfterDirectUpdate = (
      await db.query(
        `SELECT "affectedItemLabel" FROM "changeOrderImpactDecisionAffectedItem" WHERE "id" = $1`,
        [provenanceId]
      )
    ).rows[0].affectedItemLabel;
    assert(
      "Direct provenance UPDATE is denied",
      hasNoVisibleMutation(result) && provenanceAfterDirectUpdate === "RLS fixture"
    );
    result = await request(
      taskWriter,
      "changeOrderImpactDecisionAffectedItem",
      "DELETE",
      `?id=eq.${encodeURIComponent(provenanceId)}`
    );
    const provenanceStillExists = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecisionAffectedItem" WHERE "id" = $1`,
        [provenanceId]
      )
    ).rows[0].count;
    assert("Direct provenance DELETE is denied", hasNoVisibleMutation(result) && provenanceStillExists === 1);

    result = await request(taskWriter, "changeOrderImpactDecisionActionTask", "POST", "", {
      decisionId: poDecision,
      actionTaskId: sameNoticeTask,
      companyId: company,
      createdBy: userId
    });
    const directLinkCount = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecisionActionTask"
         WHERE "decisionId" = $1 AND "actionTaskId" = $2`,
        [poDecision, sameNoticeTask]
      )
    ).rows[0].count;
    assert("Direct same-Change-Notice task-link INSERT is denied", hasNoVisibleMutation(result) && directLinkCount === 0);
    const linkQuery = `?decisionId=eq.${encodeURIComponent(poDecision)}&actionTaskId=eq.${encodeURIComponent(task)}`;
    result = await request(taskWriter, "changeOrderImpactDecisionActionTask", "PATCH", linkQuery, {
      updatedBy: userId
    });
    const linkAfterDirectUpdate = (
      await db.query(
        `SELECT "updatedBy" FROM "changeOrderImpactDecisionActionTask"
         WHERE "decisionId" = $1 AND "actionTaskId" = $2`,
        [poDecision, task]
      )
    ).rows[0].updatedBy;
    assert("Direct task-link UPDATE is denied", hasNoVisibleMutation(result) && linkAfterDirectUpdate === null);
    result = await request(taskWriter, "changeOrderImpactDecisionActionTask", "DELETE", linkQuery);
    const linkStillExists = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecisionActionTask"
         WHERE "decisionId" = $1 AND "actionTaskId" = $2`,
        [poDecision, task]
      )
    ).rows[0].count;
    assert("Direct task-link DELETE is denied", hasNoVisibleMutation(result) && linkStillExists === 1);
    result = await request(taskWriter, "changeOrderImpactDecisionActionTask", "POST", "", {
      decisionId: poDecision,
      actionTaskId: otherTask,
      companyId: company,
      createdBy: userId
    });
    const crossNoticeLinkCount = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecisionActionTask"
         WHERE "decisionId" = $1 AND "actionTaskId" = $2`,
        [poDecision, otherTask]
      )
    ).rows[0].count;
    assert("Cross-Change-Notice task link is blocked", isDenied(result) && crossNoticeLinkCount === 0);
    result = await request(taskWriter, "changeOrderImpactDecisionActionTask", "POST", "", {
      decisionId: poDecision,
      actionTaskId: otherCompanyTask,
      companyId: company,
      createdBy: userId
    });
    const crossCompanyLinkCount = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecisionActionTask"
         WHERE "decisionId" = $1 AND "actionTaskId" = $2`,
        [poDecision, otherCompanyTask]
      )
    ).rows[0].count;
    assert("Cross-company task link is blocked", isDenied(result) && crossCompanyLinkCount === 0);

    const historyId = (
      await db.query(
        `SELECT "id" FROM "changeOrderImpactDecisionHistory"
         WHERE "decisionId" = $1 ORDER BY "createdAt" LIMIT 1`,
        [poDecision]
      )
    ).rows[0].id;
    result = await request(taskWriter, "changeOrderImpactDecisionHistory", "POST", "", {
      companyId: company,
      decisionId: poDecision,
      targetType: "purchaseOrderLine",
      targetId: `${prefix}-po`,
      eventType: "Direct mutation",
      newStatus: "Resolved",
      newSnapshot: {},
      createdBy: userId
    });
    const directHistoryCount = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecisionHistory"
         WHERE "decisionId" = $1 AND "eventType" = 'Direct mutation'`,
        [poDecision]
      )
    ).rows[0].count;
    assert("Direct history INSERT is denied", hasNoVisibleMutation(result) && directHistoryCount === 0);
    result = await request(
      taskWriter,
      "changeOrderImpactDecisionHistory",
      "PATCH",
      `?id=eq.${encodeURIComponent(historyId)}`,
      { rationale: "Direct mutation" }
    );
    const historyAfterDirectUpdate = (
      await db.query(
        `SELECT "rationale" FROM "changeOrderImpactDecisionHistory" WHERE "id" = $1`,
        [historyId]
      )
    ).rows[0].rationale;
    assert("Direct history UPDATE is denied", hasNoVisibleMutation(result) && historyAfterDirectUpdate === null);
    result = await request(
      taskWriter,
      "changeOrderImpactDecisionHistory",
      "DELETE",
      `?id=eq.${encodeURIComponent(historyId)}`
    );
    const historyStillExists = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecisionHistory" WHERE "id" = $1`,
        [historyId]
      )
    ).rows[0].count;
    assert("Direct history DELETE is denied", hasNoVisibleMutation(result) && historyStillExists === 1);

    result = await request(
      taskWriter,
      "changeOrderActionTask",
      "PATCH",
      `?id=eq.${encodeURIComponent(task)}`,
      { taskOrigin: "Impact follow-up" }
    );
    const apiTaskOriginAfterUpdate = (
      await db.query(`SELECT "taskOrigin" FROM "changeOrderActionTask" WHERE "id" = $1`, [task])
    ).rows[0].taskOrigin;
    assert(
      "Direct taskOrigin UPDATE is blocked",
      result.status >= 400 && result.status < 500 && apiTaskOriginAfterUpdate === "Manual"
    );
    result = await request(taskWriter, "changeOrderActionTask", "POST", "", {
      changeOrderId: notice,
      name: `${prefix}-direct-origin-insert`,
      companyId: company,
      createdBy: userId,
      taskOrigin: "Impact follow-up"
    });
    const apiDirectOriginInsertCount = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderActionTask"
         WHERE "changeOrderId" = $1 AND "name" = $2`,
        [notice, `${prefix}-direct-origin-insert`]
      )
    ).rows[0].count;
    assert(
      "Direct taskOrigin INSERT is blocked",
      result.status >= 400 && result.status < 500 && apiDirectOriginInsertCount === 0
    );
    result = await request(
      taskWriter,
      "changeOrderActionTask",
      "PATCH",
      `?id=eq.${encodeURIComponent(task)}`,
      { name: `${prefix}-ordinary-update` }
    );
    const taskAfterOrdinaryUpdate = (
      await db.query(
        `SELECT "name", "taskOrigin" FROM "changeOrderActionTask" WHERE "id" = $1`,
        [task]
      )
    ).rows[0];
    assert(
      "Ordinary task UPDATE remains available",
      result.status === 200 && rows(result).length === 1 &&
        taskAfterOrdinaryUpdate.name === `${prefix}-ordinary-update` &&
        taskAfterOrdinaryUpdate.taskOrigin === "Manual"
    );

    const sharedEmployeeJwt = getEmployeeJwt(employeeUserId);
    await setEmployeePermissions(db, employeeUserId, company, {
      partsView: true,
      partsUpdate: false,
      purchasingView: false,
      productionView: true
    });
    const companyBDecisionHidden = await employeeRequest(
      sharedEmployeeJwt,
      "changeOrderImpactDecision",
      "GET",
      otherRow
    );
    assert(
      "Employee membership without Company B permission cannot read Company B Job",
      companyBDecisionHidden.status === 200 && rows(companyBDecisionHidden).length === 0
    );
    for (const table of [
      "changeOrderImpactDecisionAffectedItem",
      "changeOrderImpactDecisionActionTask",
      "changeOrderImpactDecisionHistory"
    ]) {
      const query = table === "changeOrderImpactDecisionActionTask"
        ? otherTaskLink
        : otherChildRows(sharedDecisionId);
      const hidden = await employeeRequest(sharedEmployeeJwt, table, "GET", query);
      assert(
        `Employee Company A-only permissions hide Company B ${table}`,
        hidden.status === 200 && rows(hidden).length === 0
      );
    }

    await setEmployeePermissions(db, employeeUserId, otherCompany, {
      partsView: true,
      partsUpdate: false,
      purchasingView: false,
      productionView: true
    });
    const companyBDecisionRead = await employeeRequest(
      sharedEmployeeJwt,
      "changeOrderImpactDecision",
      "GET",
      otherRow
    );
    assert(
      "Employee Company B production permission reads the Company B Job",
      companyBDecisionRead.status === 200 && rows(companyBDecisionRead).length === 1
    );
    for (const table of [
      "changeOrderImpactDecisionAffectedItem",
      "changeOrderImpactDecisionActionTask",
      "changeOrderImpactDecisionHistory"
    ]) {
      const query = table === "changeOrderImpactDecisionActionTask"
        ? otherTaskLink
        : otherChildRows(sharedDecisionId);
      const visible = await employeeRequest(sharedEmployeeJwt, table, "GET", query);
      assert(
        `Employee Company B production permission reads Company B ${table}`,
        visible.status === 200 && rows(visible).length === 1
      );
    }

    await setEmployeePermissions(db, employeeUserId, [company, otherCompany], {
      partsView: true,
      partsUpdate: false,
      purchasingView: false,
      productionView: true
    });
    const sharedChildQuery =
      `?companyId=eq.${encodeURIComponent(company)}&decisionId=eq.${encodeURIComponent(sharedDecisionId)}&select=id`;
    for (const table of [
      "changeOrderImpactDecisionAffectedItem",
      "changeOrderImpactDecisionActionTask",
      "changeOrderImpactDecisionHistory"
    ]) {
      const query = table === "changeOrderImpactDecisionActionTask"
        ? `?companyId=eq.${encodeURIComponent(company)}&decisionId=eq.${encodeURIComponent(sharedDecisionId)}&actionTaskId=eq.${encodeURIComponent(task)}&select=decisionId,actionTaskId,companyId`
        : sharedChildQuery;
      const hidden = await employeeRequest(sharedEmployeeJwt, table, "GET", query);
      assert(
        `Company A same-ID ${table} cannot borrow Company B source authorization`,
        hidden.status === 200 && rows(hidden).length === 0
      );
    }

    await runEmployeeSessionChecks(
      db,
      company,
      employeeUserId,
      notice,
      poDecision,
      jobDecision,
      materialDecision,
      task
    );

    console.log("DIRECT POSTGREST AND EMPLOYEE SESSION RLS CHECKS PASSED");
  } finally {
    let cleanupFailed = false;
    const cleanup = async (label: string, operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        cleanupFailed = true;
        console.error(`CLEANUP FAILED: ${label}`, error);
      }
    };

    for (const [membershipUserId, membershipCompanyId] of fixture.employeeMemberships) {
      await cleanup(`remove employee membership ${membershipCompanyId}`, async () => {
        const result = await db.query(
          `DELETE FROM "userToCompany" WHERE "userId" = $1 AND "companyId" = $2 RETURNING "userId"`,
          [membershipUserId, membershipCompanyId]
        );
        if (result.rowCount !== 1) throw new Error("employee membership fixture was not removed");
      });
    }
    if (fixture.groupMemberships.length) {
      await cleanup("delete employee group memberships", async () => {
        const result = await db.query(
          `DELETE FROM "membership" WHERE "id" = ANY($1::int[]) RETURNING "id"`,
          [fixture.groupMemberships]
        );
        if (result.rowCount !== fixture.groupMemberships.length) {
          throw new Error(`expected ${fixture.groupMemberships.length} group memberships, deleted ${result.rowCount}`);
        }
      });
    }
    for (const [employeeId, employeeCompanyId] of fixture.employeeRows) {
      await cleanup(`delete employee fixture ${employeeId}/${employeeCompanyId}`, async () => {
        const result = await db.query(
          `DELETE FROM "employee" WHERE "id" = $1 AND "companyId" = $2 RETURNING "id"`,
          [employeeId, employeeCompanyId]
        );
        if (result.rowCount !== 1) throw new Error("employee fixture was not removed");
      });
    }
    for (const [employeeTypeId, employeeCompanyId] of fixture.employeeTypes) {
      await cleanup(`delete employee type fixture ${employeeTypeId}/${employeeCompanyId}`, async () => {
        const result = await db.query(
          `DELETE FROM "employeeType" WHERE "id" = $1 AND "companyId" = $2 RETURNING "id"`,
          [employeeTypeId, employeeCompanyId]
        );
        if (result.rowCount !== 1) throw new Error("employee type fixture was not removed");
      });
    }
    for (const [employeeGroupId, employeeGroupCompanyId] of fixture.employeeGroups) {
      await cleanup(`delete employee group fixture ${employeeGroupId}`, async () => {
        const result = await db.query(
          `DELETE FROM "group"
           WHERE "id" = $1 AND "companyId" IS NOT DISTINCT FROM $2
           RETURNING "id"`,
          [employeeGroupId, employeeGroupCompanyId]
        );
        if (result.rowCount !== 1) throw new Error("employee group fixture was not removed");
      });
    }
    if (authAdmin) {
      for (const fixtureEmployeeUserId of fixture.authUsers) {
        await cleanup("delete dedicated auth employee", async () => {
          const { error } = await authAdmin.auth.admin.deleteUser(fixtureEmployeeUserId);
          if (error) throw error;
        });
      }
    }
    for (const fixtureEmployeeUserId of fixture.publicUsers) {
      await cleanup("delete dedicated Carbon user", async () => {
        const result = await db.query(
          `DELETE FROM "user" WHERE "id" = $1 RETURNING "id"`,
          [fixtureEmployeeUserId]
        );
        if (result.rowCount !== 1) throw new Error("Carbon public user fixture was not removed");
      });
    }
    for (const [decisionId, actionTaskId, companyId] of fixture.links) {
      await cleanup(`delete task link ${decisionId}/${actionTaskId}/${companyId}`, async () => {
        const result = await db.query(
          `DELETE FROM "changeOrderImpactDecisionActionTask"
           WHERE "decisionId" = $1 AND "actionTaskId" = $2 AND "companyId" = $3
           RETURNING "decisionId"`,
          [decisionId, actionTaskId, companyId]
        );
        if (result.rowCount !== 1) throw new Error("task link fixture was not removed");
      });
    }
    for (const [historyId, historyCompanyId] of fixture.history) {
      await cleanup(`delete history fixture ${historyId}/${historyCompanyId}`, async () => {
        const result = await db.query(
          `DELETE FROM "changeOrderImpactDecisionHistory"
           WHERE "id" = $1 AND "companyId" = $2 RETURNING "id"`,
          [historyId, historyCompanyId]
        );
        if (result.rowCount !== 1) throw new Error("history fixture was not removed");
      });
    }
    for (const [provenanceId, provenanceCompanyId] of fixture.provenance) {
      await cleanup(`delete provenance fixture ${provenanceId}/${provenanceCompanyId}`, async () => {
        const result = await db.query(
          `DELETE FROM "changeOrderImpactDecisionAffectedItem"
           WHERE "id" = $1 AND "companyId" = $2 RETURNING "id"`,
          [provenanceId, provenanceCompanyId]
        );
        if (result.rowCount !== 1) throw new Error("provenance fixture was not removed");
      });
    }
    for (const [decisionId, decisionCompanyId] of fixture.decisions) {
      await cleanup(`delete decision fixture ${decisionId}/${decisionCompanyId}`, async () => {
        const result = await db.query(
          `DELETE FROM "changeOrderImpactDecision"
           WHERE "id" = $1 AND "companyId" = $2 RETURNING "id"`,
          [decisionId, decisionCompanyId]
        );
        if (result.rowCount !== 1) throw new Error("decision fixture was not removed");
      });
    }
    if (fixture.tasks.length) {
      await cleanup("delete task fixtures", async () => {
        const result = await db.query(
          `DELETE FROM "changeOrderActionTask" WHERE "id" = ANY($1::text[]) RETURNING "id"`,
          [fixture.tasks]
        );
        if (result.rowCount !== fixture.tasks.length) {
          throw new Error(`expected ${fixture.tasks.length} tasks, deleted ${result.rowCount}`);
        }
      });
    }
    if (fixture.notices.length) {
      await cleanup("delete Change Notice fixtures", async () => {
        const result = await db.query(
          `DELETE FROM "changeOrder" WHERE "id" = ANY($1::text[]) RETURNING "id"`,
          [fixture.notices]
        );
        if (result.rowCount !== fixture.notices.length) {
          throw new Error(`expected ${fixture.notices.length} Change Notices, deleted ${result.rowCount}`);
        }
      });
    }
    if (fixture.apiKeys.length) {
      await cleanup("delete API key fixtures", async () => {
        const result = await db.query(
          `DELETE FROM "apiKey" WHERE "id" = ANY($1::text[]) RETURNING "id"`,
          [fixture.apiKeys]
        );
        if (result.rowCount !== fixture.apiKeys.length) {
          throw new Error(`expected ${fixture.apiKeys.length} API keys, deleted ${result.rowCount}`);
        }
      });
    }
    for (const tableName of fixture.generatedCompanyTables) {
      const quotedTableName = tableName.replaceAll('"', '""');
      await cleanup(`drop generated company table ${tableName}`, async () => {
        await db.query(`DROP TABLE IF EXISTS "${quotedTableName}" CASCADE`);
        const result = await db.query(`SELECT to_regclass($1) AS "tableName"`, [`public.${tableName}`]);
        if (result.rows[0]?.tableName !== null) throw new Error("generated company table was not removed");
      });
    }
    if (fixture.companies.length) {
      await cleanup("delete company fixtures", async () => {
        const result = await db.query(
          `DELETE FROM "company" WHERE "id" = ANY($1::text[]) RETURNING "id"`,
          [fixture.companies]
        );
        if (result.rowCount !== fixture.companies.length) {
          throw new Error(`expected ${fixture.companies.length} companies, deleted ${result.rowCount}`);
        }
      });
    }
    await cleanup("close database connection", () => db.end());
    if (cleanupFailed) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
