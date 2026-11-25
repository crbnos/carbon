// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { validateEnv } from "@carbon/env/validate";
import type { Node } from "libpg-query";
import {
  type Check,
  defineCheck,
  type SourceFile,
  type Violation
} from "../check";
import {
  loadIntegrationConfigs,
  read,
  readIfPresent
} from "../sources/cross-file";
import { migrations } from "../sources/inputs";
import {
  nameParts,
  nodesIn,
  relationName,
  sqlFragments,
  sqlNodes
} from "../sources/sql";
import { lineOf } from "../sources/text";

// Checks that keep two places in step: a value written in one file and
// repeated in another, where nothing else fails when only one side changes.
// Each is a pure `find*` function over the files it compares, so its tests pass
// their own fixtures, and a check that declares those files in its `reads`.

export const EVENT_IGNORED_COLUMNS = "event-ignored-columns";

export const EVENT_FUNCTIONS_DIR =
  "packages/database/src/event-system/functions";
export const AUDIT_CONFIG_FILE = "packages/database/src/audit.config.ts";

export function loadEventFunctionSources(root: string) {
  return {
    functions: readdirSync(join(root, EVENT_FUNCTIONS_DIR))
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => read(root, `${EVENT_FUNCTIONS_DIR}/${file}`)),
    auditConfig: read(root, AUDIT_CONFIG_FILE)
  };
}

/**
 * The event triggers drop an UPDATE that changes only bookkeeping columns
 * before it is queued, broadcast or logged, because the audit diff would
 * discard it anyway (`auditConfig.skipFields`). A column added on one side
 * only makes the triggers and the handler disagree.
 */
export function findIgnoredColumnDrift(
  functions: SourceFile[],
  auditConfig: SourceFile
): Violation[] {
  const skip = /skipFields:\s*\[([^\]]*)\]/.exec(auditConfig.contents)?.[1];
  if (skip === undefined) {
    return [
      {
        file: auditConfig.file,
        line: 0,
        snippet: "skipFields",
        message: "auditConfig.skipFields not found"
      }
    ];
  }
  const expected = [...skip.matchAll(/"([^"]+)"/g)]
    .map((m) => m[1] as string)
    .sort();

  const out: Violation[] = [];
  for (const { file, contents } of functions) {
    // `ignored_columns CONSTANT TEXT[] := ARRAY['a', 'b']` in a DECLARE.
    const declared = sqlFragments(contents).find(
      (fragment) => fragment.variable === "ignored_columns"
    );
    const [statement] = declared?.statements ?? [];
    if (!statement) continue;
    const columns: string[] = [];
    for (const { node } of nodesIn(statement.node)) {
      const value = "A_Const" in node ? node.A_Const.sval?.sval : undefined;
      if (value !== undefined) columns.push(value);
    }
    columns.sort();
    if (columns.join() === expected.join()) continue;
    out.push({
      file,
      line: statement.line,
      snippet: `ignored_columns ${columns.join(",")}`,
      message: `ignored_columns must equal auditConfig.skipFields (${expected.join(", ")})`
    });
  }
  return out;
}

export const eventIgnoredColumns = defineCheck({
  id: EVENT_IGNORED_COLUMNS,
  description:
    "The event triggers drop an UPDATE that changes only bookkeeping columns before it is queued, broadcast or logged, because the audit diff would discard it anyway (`auditConfig.skipFields`).",
  reads: { sources: loadEventFunctionSources },
  find: ({ sources }) =>
    findIgnoredColumnDrift(sources.functions, sources.auditConfig)
});

export const PROVIDER_ROLE_BACKFILLED = "provider-role-backfilled";

function stringOf(node: Node | undefined): string | undefined {
  return node && "A_Const" in node ? node.A_Const.sval?.sval : undefined;
}

/**
 * `UPDATE "integration" SET "providerRole" = 'x' | NULL WHERE id = 'a'` or
 * `… WHERE id IN ('a', 'b')`: the role, and the integrations it is set on.
 */
function providerRoleUpdate(
  node: Node
): { role: string | null; ids: string[] } | undefined {
  if (!("UpdateStmt" in node)) return undefined;
  const { relation, targetList, whereClause } = node.UpdateStmt;
  if (relationName(relation ?? {}) !== "integration") return undefined;
  const target = (targetList ?? []).flatMap((item) =>
    "ResTarget" in item && item.ResTarget.name === "providerRole"
      ? [item.ResTarget.val]
      : []
  )[0];
  if (!target || !("A_Const" in target)) return undefined;
  // The test on `id`, wherever it sits in the WHERE: it may be one of several
  // joined by AND.
  const ids: string[] = [];
  for (const { node: test } of nodesIn(whereClause)) {
    if (!("A_Expr" in test)) continue;
    const { kind, name, lexpr, rexpr } = test.A_Expr;
    if (kind !== "AEXPR_OP" && kind !== "AEXPR_IN") continue;
    // `=` for both: the parser writes `IN` as `=` and `NOT IN` as `<>`.
    if (nameParts(name)[0] !== "=") continue;
    const column =
      lexpr && "ColumnRef" in lexpr
        ? nameParts(lexpr.ColumnRef.fields).at(-1)
        : undefined;
    if (column !== "id") continue;
    const values =
      rexpr && "List" in rexpr ? (rexpr.List.items ?? []) : [rexpr];
    ids.push(...values.flatMap((value) => stringOf(value) ?? []));
  }
  return {
    role: target.A_Const.isnull ? null : (stringOf(target) ?? null),
    ids
  };
}

/**
 * `providerRole` is declared twice by necessity: on the integration's
 * `config.tsx` (`packages/ee/src/<id>/`), which the app reads, and on the
 * `integration` row, which the `companyIntegration_single_active_role` trigger
 * reads. The trigger returns early on NULL, so a descriptor whose role no
 * migration set fails as "no enforcement", not as an error.
 *
 * Replays every `UPDATE "integration" SET "providerRole" = …` in migration
 * order and compares the result with the descriptors, both ways.
 */
export function findProviderRoleDrift(
  configs: SourceFile[],
  migrations: SourceFile[]
): Violation[] {
  const declared = new Map<
    string,
    { role: string; file: string; line: number }
  >();
  for (const { file, contents } of configs) {
    const role = /providerRole:\s*"(\w+)"/.exec(contents);
    const id = /\n\s*id:\s*"([^"]+)"/.exec(contents);
    if (!role?.[1] || !id?.[1]) continue;
    declared.set(id[1], {
      role: role[1],
      file,
      line: lineOf(contents, role.index)
    });
  }

  const stored = new Map<string, { role: string | null; file: string }>();
  for (const { file, contents } of migrations) {
    for (const { node } of sqlNodes(contents)) {
      const update = providerRoleUpdate(node);
      if (!update) continue;
      for (const id of update.ids) stored.set(id, { role: update.role, file });
    }
  }

  const out: Violation[] = [];
  for (const [id, { role, file, line }] of declared) {
    const row = stored.get(id)?.role ?? null;
    if (row === role) continue;
    out.push({
      file,
      line,
      snippet: `${id}: ${role} declared, ${row ?? "NULL"} stored`,
      message: `No migration sets integration "${id}" to providerRole '${role}', so the one-active-per-role trigger does not guard it; add UPDATE "integration" SET "providerRole" = '${role}' WHERE id = '${id}'`
    });
  }
  for (const [id, { role, file }] of stored) {
    if (role === null || declared.has(id)) continue;
    out.push({
      file,
      line: 0,
      snippet: `${id}: ${role} stored, none declared`,
      message: `Integration "${id}" has providerRole '${role}' in the database but its config declares none`
    });
  }
  return out;
}

export const providerRoleBackfilled = defineCheck({
  id: PROVIDER_ROLE_BACKFILLED,
  description:
    "An integration's providerRole in its config matches the role the migrations set on its row.",
  // Migrations first: the runner groups a check by its first input, so this
  // check runs on the worker that has already parsed their SQL.
  reads: { migrations, configs: loadIntegrationConfigs },
  find: ({ configs, migrations }) => findProviderRoleDrift(configs, migrations)
});

export const SCHEDULED_SQL_CONSTANTS = "scheduled-sql-constants";

const SCHEDULED = "packages/jobs/src/inngest/functions/scheduled";

/**
 * pg_cron wakes a scheduled function only when its `util.*_has_work()` says a
 * run would do something, and that SQL repeats the function's constants. A
 * constant changed on one side only either wakes the function for nothing or
 * leaves work undone. `{NAME}` is the constant's value; a string array is
 * written as SQL literals, `'a', 'b'`.
 */
export const SCHEDULED_WORK_CHECKS = [
  {
    fn: "util.notification_digest_has_work",
    constants: `${SCHEDULED}/notification-digest.ts`,
    expected: [
      "c.total >= {DIGEST_THRESHOLD}",
      "interval '{DIGEST_MIN_AGE_MIN} minutes'"
    ]
  },
  {
    fn: "util.workflow_run_retention_has_work",
    constants: `${SCHEDULED}/workflow-run-retention.ts`,
    expected: [
      "interval '{STALE_RUN_HOURS} hours'",
      "interval '{FULL_DETAIL_DAYS} days'",
      "interval '{COMPACT_DETAIL_DAYS} days'",
      "interval '{RUN_HEADER_DAYS} days'",
      "IN ({TERMINAL})"
    ]
  }
];

export function loadScheduledConstantSources(root: string): SourceFile[] {
  return readIfPresent(
    root,
    SCHEDULED_WORK_CHECKS.map(({ constants }) => constants)
  );
}

/** `export const NAME = 5` and `export const NAME = ["a", "b"] as const`. */
function constantsOf(contents: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of contents.matchAll(
    /export const (\w+)\s*=\s*(-?\d+(?:\.\d+)?|\[[^\]]*\])/g
  )) {
    const value = m[2] ?? "";
    out.set(
      m[1] ?? "",
      value.startsWith("[")
        ? [...value.matchAll(/"([^"]*)"/g)].map((s) => `'${s[1]}'`).join(", ")
        : value
    );
  }
  return out;
}

/** The newest `CREATE FUNCTION <fn>` in migration order, as it is written. */
function newestDefinition(fn: string, migrations: SourceFile[]) {
  for (const { file, contents } of [...migrations].reverse()) {
    const definitions = [...sqlNodes(contents)].filter(
      ({ node }) =>
        "CreateFunctionStmt" in node &&
        nameParts(node.CreateFunctionStmt.funcname).join(".") === fn
    );
    const newest = definitions.at(-1);
    if (newest) return { file, body: newest.statement.text };
  }
  return null;
}

export function findScheduledSqlDrift(
  migrations: SourceFile[],
  sources: SourceFile[]
): Violation[] {
  const out: Violation[] = [];
  for (const { fn, constants, expected } of SCHEDULED_WORK_CHECKS) {
    const source = sources.find((s) => s.file === constants);
    const definition = newestDefinition(fn, migrations);
    if (!source || !definition) {
      out.push({
        file: source ? constants : "packages/database/supabase/migrations",
        line: 0,
        snippet: fn,
        message: source
          ? `No migration defines ${fn}`
          : `${constants} not found; update SCHEDULED_WORK_CHECKS`
      });
      continue;
    }
    const values = constantsOf(source.contents);
    for (const template of expected) {
      const missing = [...template.matchAll(/\{(\w+)\}/g)]
        .map((m) => m[1] as string)
        .filter((name) => !values.has(name));
      const text = template.replace(
        /\{(\w+)\}/g,
        (_, name: string) => values.get(name) ?? ""
      );
      if (missing.length === 0 && definition.body.includes(text)) continue;
      out.push({
        file: definition.file,
        line: 0,
        snippet: `${fn}: ${template}`,
        message: missing.length
          ? `${missing.join(", ")} not exported from ${constants}`
          : `${fn} must contain ${text} to match ${constants}; redefine it in a new migration`
      });
    }
  }
  return out;
}

export const scheduledSqlConstants = defineCheck({
  id: SCHEDULED_SQL_CONSTANTS,
  description:
    "pg_cron wakes a scheduled function only when its `util.*_has_work()` says a run would do something, and that SQL repeats the function's constants.",
  // Migrations first: the runner groups a check by its first input, so this
  // check runs on the worker that has already parsed their SQL.
  reads: { migrations, constants: loadScheduledConstantSources },
  find: ({ migrations, constants }) =>
    findScheduledSqlDrift(migrations, constants)
});

export const DOCUMENT_SEQUENCE_SYNCED = "document-sequence-synced";

export const SEED_DATA_FILE = "packages/database/src/seed-data.ts";
export const ATTACHMENTS_FILE =
  "packages/database/src/event-system/attachments.ts";
export const INTERCEPTOR_FILE =
  "packages/database/src/event-system/handlers/sync_advance_document_sequence.sql";

/** The three files `findUnsyncedDocumentSequences` compares. */
export function loadDocumentSequenceSources(root: string): {
  seedData: SourceFile;
  attachments: SourceFile;
  interceptor: SourceFile;
} {
  return {
    seedData: read(root, SEED_DATA_FILE),
    attachments: read(root, ATTACHMENTS_FILE),
    interceptor: read(root, INTERCEPTOR_FILE)
  };
}

const INTERCEPTOR = "sync_advance_document_sequence";

/** A counter named differently from the table whose numbers it issues. */
const COUNTER_TABLES: Record<string, string> = {
  journalEntry: "journal",
  creditMemo: "memo",
  debitMemo: "memo"
};

/**
 * Counters whose numbers only ever come from get_next_sequence / getNextSequence:
 * no form, MCP tool or API write takes the number from the caller (checked
 * 2026-10-09). Everything else must be kept ahead of saved numbers by the
 * interceptor, or a caller-chosen number leaves the counter behind and later
 * inserts fail on the unique constraint.
 */
export const EXEMPT_COUNTERS: Record<string, string> = {
  charge: "no form or API write takes chargeId",
  fixedAssetTransfer:
    "no form or API write takes its transferId (the transferId tools are warehouse transfers)",
  inspection: "no form or API write takes inspectionId",
  jobOperationBatch: "no form or API write takes a batch's readableId",
  leaseRun:
    "a lease run is a revenueRecognitionRun of type Lease; no form or API write takes runId",
  reimbursement:
    "no form or API write takes reimbursementId (reimbursement lines only reference their parent)",
  revenueRecognitionRun: "no form or API write takes runId",
  projectStockTransfer:
    "no form or API write takes projectStockTransferId (the transfer insert takes it from get_next_sequence)"
};

type Entry = { name: string; line: number };

/** The `table:` of every counter in `export const sequences = [...]`. */
function counters(seedData: string): Entry[] {
  const start = seedData.indexOf("export const sequences = [");
  if (start === -1) return [];
  const end = seedData.indexOf("\n]", start);
  const block = seedData.slice(start, end === -1 ? undefined : end);
  return [...block.matchAll(/table: "(\w+)"/g)].map((m) => ({
    name: m[1] as string,
    line: lineOf(seedData, start + (m.index ?? 0))
  }));
}

function attachedTables(attachments: string): Entry[] {
  const keys = [...attachments.matchAll(/^ {2}(\w+): \{/gm)];
  return keys.flatMap((m, i) => {
    const from = m.index ?? 0;
    const to = keys[i + 1]?.index ?? attachments.length;
    return attachments.slice(from, to).includes(`"${INTERCEPTOR}"`)
      ? [{ name: m[1] as string, line: lineOf(attachments, from) }]
      : [];
  });
}

/** Tables named in the interceptor's `CASE p_table` (WHEN 'table' THEN 'column'). */
function interceptedTables(interceptor: string): Entry[] {
  const tables: Entry[] = [];
  for (const { node, line } of sqlNodes(interceptor)) {
    if (!("CaseWhen" in node)) continue;
    const { expr, result } = node.CaseWhen;
    const table =
      expr && "A_Const" in expr ? expr.A_Const.sval?.sval : undefined;
    const column =
      result && "A_Const" in result ? result.A_Const.sval?.sval : undefined;
    if (table !== undefined && column !== undefined) {
      tables.push({ name: table, line });
    }
  }
  return tables;
}

/**
 * Every counter is either kept ahead of saved numbers by
 * sync_advance_document_sequence or exempt with a reason, and the interceptor's
 * table list matches the tables it is attached to.
 */
export function findUnsyncedDocumentSequences(sources: {
  seedData: SourceFile;
  attachments: SourceFile;
  interceptor: SourceFile;
}): Violation[] {
  const attached = attachedTables(sources.attachments.contents);
  const intercepted = interceptedTables(sources.interceptor.contents);
  const attachedNames = new Set(attached.map((t) => t.name));
  const interceptedNames = new Set(intercepted.map((t) => t.name));
  const out: Violation[] = [];

  for (const counter of counters(sources.seedData.contents)) {
    const table = COUNTER_TABLES[counter.name] ?? counter.name;
    const covered = attachedNames.has(table) && interceptedNames.has(table);
    const exempt = counter.name in EXEMPT_COUNTERS;
    if (!covered && !exempt) {
      out.push({
        file: sources.seedData.file,
        line: counter.line,
        snippet: `table: "${counter.name}"`,
        message: `Counter "${counter.name}" is not kept ahead of saved numbers. Add "${table}" to the CASE in ${INTERCEPTOR}.sql and give it the interceptor in attachments.ts, or add "${counter.name}" to EXEMPT_COUNTERS with the reason no caller ever supplies its number.`
      });
    }
    if (covered && exempt) {
      out.push({
        file: sources.seedData.file,
        line: counter.line,
        snippet: `table: "${counter.name}"`,
        message: `Counter "${counter.name}" is covered by ${INTERCEPTOR}; remove it from EXEMPT_COUNTERS.`
      });
    }
  }

  for (const table of attached) {
    if (!interceptedNames.has(table.name)) {
      out.push({
        file: sources.attachments.file,
        line: table.line,
        snippet: table.name,
        message: `"${table.name}" runs ${INTERCEPTOR} but is missing from its CASE, so the interceptor ignores it.`
      });
    }
  }

  for (const table of intercepted) {
    if (!attachedNames.has(table.name)) {
      out.push({
        file: sources.interceptor.file,
        line: table.line,
        snippet: `WHEN '${table.name}'`,
        message: `"${table.name}" is in the ${INTERCEPTOR} CASE but not attached in attachments.ts, so it never runs.`
      });
    }
  }

  return out;
}

export const documentSequenceSynced = defineCheck({
  id: DOCUMENT_SEQUENCE_SYNCED,
  description:
    "Every counter is either kept ahead of saved numbers by sync_advance_document_sequence or exempt with a reason, and the interceptor's table list matches the tables it is attached to.",
  reads: { sources: loadDocumentSequenceSources },
  find: ({ sources }) => findUnsyncedDocumentSequences(sources)
});

export const DEPLOYMENTS_SET_REQUIRED_ENV = "deployments-set-required-env";

export const DEPLOYMENT_ENV_FILES = {
  sst: "sst.config.ts",
  devEnv: "packages/dev/src/env.ts",
  envExample: ".env.example",
  // Names only, from `vercel env ls production` plus the team's shared
  // variables. Add a name here when someone adds it in Vercel.
  vercel: "packages/env/src/vercel-production.json"
} as const;

export type DeploymentEnvSources = Record<
  keyof typeof DEPLOYMENT_ENV_FILES,
  SourceFile
>;

export function loadDeploymentEnvSources(root: string): DeploymentEnvSources {
  return Object.fromEntries(
    Object.entries(DEPLOYMENT_ENV_FILES).map(([key, file]) => [
      key,
      read(root, file)
    ])
  ) as DeploymentEnvSources;
}

type Deployment = { name: string; file: string; keys: string[] };

/** The variable names each real deployment sets, read from the file that sets them. */
export function deploymentEnvKeys(sources: DeploymentEnvSources): Deployment[] {
  const { sst, devEnv, envExample, vercel } = sources;
  const services = [...sst.contents.matchAll(/environment: \{/g)].map(
    (env, i) => {
      const start = (env.index ?? 0) + env[0].length;
      const owner = [
        ...sst.contents.slice(0, start).matchAll(/addService\(\s*"([^"]+)"/g)
      ].at(-1)?.[1];
      const block = sst.contents.slice(start).split("\n      },")[0] ?? "";
      return {
        name: `SST ${owner ?? `service ${i + 1}`}`,
        file: sst.file,
        keys: [...block.matchAll(/^\s+([A-Z0-9_]+):/gm)].map(
          (m) => m[1] as string
        )
      };
    }
  );
  const local = {
    name: "local crbn up",
    file: devEnv.file,
    keys: [
      ...devEnv.contents.matchAll(/[`"]([A-Z0-9_]+)=/g),
      ...envExample.contents.matchAll(/^([A-Z0-9_]+)=/gm)
    ].map((m) => m[1] as string)
  };
  const projects = Object.entries(
    JSON.parse(vercel.contents) as Record<string, string[]>
  ).map(([project, keys]) => ({
    name: `Vercel ${project}`,
    file: vercel.file,
    // Vercel itself adds NODE_ENV at runtime.
    keys: [...keys, "NODE_ENV"]
  }));
  return [...services, local, ...projects];
}

/**
 * A variable that stops startup when missing must already be set by every
 * deployment, or adding it takes production down. `missingRequired` is
 * `@carbon/env`'s validation: the names it reports as errors for an env.
 */
export function findDeploymentEnvGaps(
  sources: DeploymentEnvSources,
  missingRequired: (env: Record<string, string>) => string[]
): Violation[] {
  return deploymentEnvKeys(sources).flatMap(({ name, file, keys }) =>
    missingRequired(Object.fromEntries(keys.map((key) => [key, "set"]))).map(
      (variable) => ({
        file,
        line: 0,
        snippet: `${name}: ${variable}`,
        message: `${variable} is required at startup but ${name} does not set it; set it there first, or make it optional`
      })
    )
  );
}

export const deploymentsSetRequiredEnv = defineCheck({
  id: DEPLOYMENTS_SET_REQUIRED_ENV,
  description:
    "A variable that stops startup when missing must already be set by every deployment, or adding it takes production down.",
  reads: { sources: loadDeploymentEnvSources },
  find: ({ sources }) =>
    findDeploymentEnvGaps(sources, (env) =>
      validateEnv(env)
        .problems.filter((p) => p.level === "error")
        .map((p) => p.name)
    )
});

export const OFFLINE_PAGE_CACHE_BUMPED = "offline-page-cache-bumped";

const PIN_FILE = "packages/checks/src/conformance/drift.ts";

export const OFFLINE_APPS = {
  erp: {
    page: "apps/erp/public/offline.html",
    worker: "apps/erp/public/service-worker.js",
    constant: "OFFLINE_CACHE"
  },
  mes: {
    page: "apps/mes/public/offline.html",
    worker: "apps/mes/public/service-worker.js",
    constant: "SHELL_CACHE"
  }
} as const;

export type OfflineApp = keyof typeof OFFLINE_APPS;

/**
 * A worker re-caches offline.html only when it reinstalls, which takes a
 * change to service-worker.js: a new page needs new cache names.
 */
export const OFFLINE_PAGE: {
  sha256: string;
  caches: Record<OfflineApp, string>;
} = {
  sha256: "82d00b39fa70f0c33ec54fa8b98480bc42cfb4dfd37d28decd89181b8ff3f2de",
  caches: { erp: "erp-offline-v5", mes: "mes-shell-v5" }
};

export type OfflinePageSources = Record<
  OfflineApp,
  { page: SourceFile; worker: SourceFile }
>;

export function loadOfflinePageSources(root: string): OfflinePageSources {
  return {
    erp: {
      page: read(root, OFFLINE_APPS.erp.page),
      worker: read(root, OFFLINE_APPS.erp.worker)
    },
    mes: {
      page: read(root, OFFLINE_APPS.mes.page),
      worker: read(root, OFFLINE_APPS.mes.worker)
    }
  };
}

const APPS = Object.keys(OFFLINE_APPS) as OfflineApp[];

function nextCacheName(name: string): string {
  const match = name.match(/^(.*-v)(\d+)$/);
  return match ? `${match[1]}${Number(match[2]) + 1}` : `${name}-v2`;
}

function offlinePageLineOf(contents: string, text: string): number {
  const index = contents.indexOf(text);
  return index === -1 ? 0 : contents.slice(0, index).split("\n").length;
}

/**
 * Fails when either app's `offline.html` does not hash to
 * `OFFLINE_PAGE.sha256`, or when a `service-worker.js` does not declare the
 * cache name pinned with it. A worker saves the page only when it installs.
 * It installs only when its own file changes. So an edited page with no renamed
 * cache never reaches a browser that already has the worker.
 *
 * Both apps share one pinned hash, so ERP and MES keep serving the same page.
 * The message names the next cache names and the new sha256: update
 * `OFFLINE_PAGE` in the same change. See `.claude/rules/service-workers.md`.
 *
 * Do not baseline a finding. The snippet carries the page's hash, so a
 * baseline entry could never match a later edit.
 */
export function findStaleOfflinePageCaches(
  sources: OfflinePageSources,
  pinned: typeof OFFLINE_PAGE = OFFLINE_PAGE
): Violation[] {
  const bumps = APPS.map(
    (app) =>
      `${OFFLINE_APPS[app].constant} in ${OFFLINE_APPS[app].worker} to "${nextCacheName(pinned.caches[app])}"`
  ).join(" and ");
  const out: Violation[] = [];

  for (const app of APPS) {
    const { page } = sources[app];
    const sha256 = createHash("sha256").update(page.contents).digest("hex");
    if (sha256 !== pinned.sha256) {
      out.push({
        file: page.file,
        line: 1,
        snippet: `sha256 ${sha256}`,
        message: `offline.html changed, so browsers that have the worker keep the old page until its cache is renamed. Bump ${bumps}, copy the page so both apps serve the same file, then set OFFLINE_PAGE in ${PIN_FILE} to sha256 "${sha256}" and the new cache names.`
      });
    }
  }

  for (const app of APPS) {
    const { worker } = sources[app];
    const { constant } = OFFLINE_APPS[app];
    const declaration = `const ${constant} = "${pinned.caches[app]}";`;
    if (!worker.contents.includes(declaration)) {
      out.push({
        file: worker.file,
        line: offlinePageLineOf(worker.contents, `const ${constant} =`),
        snippet: declaration,
        message: `${worker.file} no longer declares ${declaration} If it was bumped for a new offline.html, set OFFLINE_PAGE in ${PIN_FILE} to the new page's sha256 and cache names.`
      });
    }
  }

  return out;
}

export const offlinePageCacheBumped = defineCheck({
  id: OFFLINE_PAGE_CACHE_BUMPED,
  description:
    "A worker re-caches offline.html only when it reinstalls, which takes a change to service-worker.js: a new page needs new cache names.",
  reads: { sources: loadOfflinePageSources },
  find: ({ sources }) => findStaleOfflinePageCaches(sources)
});

/** The drift checks, in the order they are written above. */
export const checks: Check[] = [
  eventIgnoredColumns,
  providerRoleBackfilled,
  scheduledSqlConstants,
  documentSequenceSynced,
  deploymentsSetRequiredEnv,
  offlinePageCacheBumped
];
