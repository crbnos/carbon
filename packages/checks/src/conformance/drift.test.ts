// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  DEPLOYMENT_ENV_FILES,
  type DeploymentEnvSources,
  deploymentEnvKeys,
  findDeploymentEnvGaps,
  findIgnoredColumnDrift,
  findProviderRoleDrift,
  findScheduledSqlDrift,
  findStaleOfflinePageCaches,
  findUnsyncedDocumentSequences,
  type OfflinePageSources,
  SCHEDULED_WORK_CHECKS
} from "./drift";

const auditConfig = {
  file: "audit.config.ts",
  contents: `export const auditConfig = {
  skipFields: ["updatedAt", "updatedBy", "embedding"],
  retentionDays: 30
} as const;`
};

const fn = (name: string, columns: string | null) => ({
  file: `${name}.sql`,
  contents: `CREATE OR REPLACE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
${columns === null ? "" : `  ignored_columns CONSTANT TEXT[] := ARRAY[${columns}];\n`}BEGIN
END;
$$;`
});

const ignoredColumnDrift = (...functions: ReturnType<typeof fn>[]) =>
  findIgnoredColumnDrift(functions, auditConfig).map((v) => v.file);

describe("findIgnoredColumnDrift", () => {
  it("accepts the same columns in any order, and functions without the list", () => {
    expect(
      ignoredColumnDrift(
        fn("log_table_changes", "'embedding', 'updatedAt', 'updatedBy'"),
        fn("get_audit_log", null)
      )
    ).toEqual([]);
  });

  it.each([
    ["an extra column", "'updatedAt', 'updatedBy', 'embedding', 'loadedAt'"],
    ["a missing column", "'updatedAt', 'updatedBy'"]
  ])("flags a trigger with %s", (_, columns) => {
    expect(ignoredColumnDrift(fn("dispatch_event_batch", columns))).toEqual([
      "dispatch_event_batch.sql"
    ]);
  });
});

const config = (id: string, role?: string) => ({
  file: `packages/ee/src/${id}/config.tsx`,
  contents: `export const X = defineIntegration({
  name: "X",
  id: "${id}",${role ? `\n  providerRole: "${role}" as const,` : ""}
  active: true
});`
});

const migration = (file: string, sql: string) => ({ file, contents: sql });

const providerRoleDrift = (...args: Parameters<typeof findProviderRoleDrift>) =>
  findProviderRoleDrift(...args).map((v) => v.snippet);

describe("findProviderRoleDrift", () => {
  it("accepts roles set by IN lists and by equality, across migrations", () => {
    expect(
      providerRoleDrift(
        [
          config("xero", "accounting"),
          config("quickbooks", "accounting"),
          config("sense", "oee")
        ],
        [
          migration(
            "1_role.sql",
            `UPDATE "integration" SET "providerRole" = 'accounting'
  WHERE id IN ('xero', 'quickbooks')
    AND "providerRole" IS DISTINCT FROM 'accounting';`
          ),
          migration(
            "2_oee.sql",
            `UPDATE "integration" SET "providerRole" = 'oee'
  WHERE "id" = 'sense' AND "providerRole" IS DISTINCT FROM 'oee';`
          )
        ]
      )
    ).toEqual([]);
  });

  it("flags a declared role that no migration stored", () => {
    expect(providerRoleDrift([config("netsuite", "accounting")], [])).toEqual([
      "netsuite: accounting declared, NULL stored"
    ]);
  });

  it("reads the latest migration's role, not the first", () => {
    expect(
      providerRoleDrift(
        [config("ramp", "accounting")],
        [
          migration(
            "1.sql",
            `UPDATE "integration" SET "providerRole" = 'accounting' WHERE id = 'ramp';`
          ),
          migration(
            "2.sql",
            `UPDATE "integration" SET "providerRole" = 'spend' WHERE id = 'ramp';`
          )
        ]
      )
    ).toEqual(["ramp: accounting declared, spend stored"]);
  });

  it("flags a stored role whose config declares none", () => {
    expect(
      providerRoleDrift(
        [config("ramp")],
        [
          migration(
            "1.sql",
            `UPDATE "integration" SET "providerRole" = 'spend' WHERE id = 'ramp';`
          )
        ]
      )
    ).toEqual(["ramp: spend stored, none declared"]);
  });
  it("does not read the id of an IS DISTINCT FROM test as the integration set", () => {
    expect(
      providerRoleDrift(
        [config("xero", "accounting")],
        [
          migration(
            "1_role.sql",
            `UPDATE "integration" SET "providerRole" = 'accounting' WHERE id IS DISTINCT FROM 'xero';`
          )
        ]
      )
    ).toEqual(["xero: accounting declared, NULL stored"]);
  });

  it("reads only a constant role set on integration, for the ids the WHERE names", () => {
    const decoys = [
      `UPDATE "otherTable" SET "providerRole" = 'accounting' WHERE id = 'xero';`,
      `UPDATE "integration" SET "providerRole" = 'accounting' WHERE "name" = 'xero';`,
      `UPDATE "integration" SET "providerRole" = lower('ACCOUNTING') WHERE id = 'xero';`,
      `UPDATE "integration" SET "providerRole" = 'accounting' WHERE id <> 'xero';`,
      `UPDATE "integration" SET "providerRole" = 'accounting' WHERE id NOT IN ('xero');`
    ];
    expect(
      providerRoleDrift(
        [config("xero", "accounting")],
        [migration("1_role.sql", decoys.join("\n"))]
      )
    ).toEqual(["xero: accounting declared, NULL stored"]);
  });
});

const [digest, retention] = SCHEDULED_WORK_CHECKS as [
  (typeof SCHEDULED_WORK_CHECKS)[number],
  (typeof SCHEDULED_WORK_CHECKS)[number]
];

const scheduledSources = (threshold = 5) => [
  {
    file: digest.constants,
    contents: `export const DIGEST_THRESHOLD = ${threshold};\nexport const DIGEST_MIN_AGE_MIN = 60;`
  },
  {
    file: retention.constants,
    contents: `export const STALE_RUN_HOURS = 24;
export const FULL_DETAIL_DAYS = 7;
export const COMPACT_DETAIL_DAYS = 30;
export const RUN_HEADER_DAYS = 90;
export const TERMINAL = ["Succeeded", "Failed"] as const;`
  }
];

const digestSql = (
  total: number
) => `CREATE OR REPLACE FUNCTION util.notification_digest_has_work()
RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 WHERE "createdAt" < now() - interval '60 minutes' AND c.total >= ${total})
$$;`;

const retentionSql = `CREATE OR REPLACE FUNCTION util.workflow_run_retention_has_work()
RETURNS boolean AS $$
  SELECT now() - interval '24 hours', interval '7 days', interval '30 days',
    interval '90 days', "status" IN ('Succeeded', 'Failed')
$$;`;

const scheduledSqlDrift = (migrations: string[], threshold?: number) =>
  findScheduledSqlDrift(
    migrations.map((contents, i) => ({ file: `${i}.sql`, contents })),
    scheduledSources(threshold)
  ).map((v) => v.snippet);

describe("findScheduledSqlDrift", () => {
  it("accepts SQL that repeats every constant", () => {
    expect(scheduledSqlDrift([digestSql(5), retentionSql])).toEqual([]);
  });

  it("flags a constant changed in TypeScript only", () => {
    expect(scheduledSqlDrift([digestSql(5), retentionSql], 10)).toEqual([
      "util.notification_digest_has_work: c.total >= {DIGEST_THRESHOLD}"
    ]);
  });

  it("reads the newest definition, so a later migration's change counts", () => {
    expect(
      scheduledSqlDrift([digestSql(5), retentionSql, digestSql(10)], 10)
    ).toEqual([]);
    expect(
      scheduledSqlDrift([digestSql(10), retentionSql, digestSql(5)], 10)
    ).toEqual([
      "util.notification_digest_has_work: c.total >= {DIGEST_THRESHOLD}"
    ]);
  });

  it("flags a function no migration defines", () => {
    expect(scheduledSqlDrift([retentionSql])).toEqual([
      "util.notification_digest_has_work"
    ]);
  });
});

const seedData = (...tables: string[]) => ({
  file: "seed-data.ts",
  contents: `export const sequences = [\n${tables
    .map((t) => `  {\n    table: "${t}",\n    prefix: "X"\n  },`)
    .join("\n")}\n] as const;\n`
});

const attachments = (...tables: string[]) => ({
  file: "attachments.ts",
  contents: `export const attachments = {\n${tables
    .map(
      (t) =>
        `  ${t}: { after: ["sync_advance_document_sequence"], events: true },`
    )
    .join("\n")}\n  other: { events: true }\n} as const;\n`
});

const interceptor = (...tables: string[]) => ({
  file: "sync_advance_document_sequence.sql",
  contents: `CREATE FUNCTION sync_advance_document_sequence(p_table TEXT) RETURNS void LANGUAGE plpgsql AS $$\nDECLARE\n  v_column TEXT;\nBEGIN\n  v_column := CASE p_table\n${tables
    .map((t) => `    WHEN '${t}' THEN '${t}Id'`)
    .join("\n")}\n    ELSE NULL\n  END;\nEND $$;\n`
});

const messages = (
  sources: Parameters<typeof findUnsyncedDocumentSequences>[0]
) =>
  findUnsyncedDocumentSequences(sources).map((v) => `${v.file}: ${v.snippet}`);

describe("findUnsyncedDocumentSequences", () => {
  it("accepts a counter whose table is attached and in the CASE", () => {
    expect(
      messages({
        seedData: seedData("salesOrder"),
        attachments: attachments("salesOrder"),
        interceptor: interceptor("salesOrder")
      })
    ).toEqual([]);
  });

  it("flags a new counter that is neither covered nor exempt", () => {
    expect(
      messages({
        seedData: seedData("salesOrder", "widgetOrder"),
        attachments: attachments("salesOrder"),
        interceptor: interceptor("salesOrder")
      })
    ).toEqual(['seed-data.ts: table: "widgetOrder"']);
  });

  it("accepts an exempt counter, and flags one that is also covered", () => {
    expect(
      messages({
        seedData: seedData("inspection"),
        attachments: attachments(),
        interceptor: interceptor()
      })
    ).toEqual([]);
    expect(
      messages({
        seedData: seedData("inspection"),
        attachments: attachments("inspection"),
        interceptor: interceptor("inspection")
      })
    ).toEqual(['seed-data.ts: table: "inspection"']);
  });

  it("maps counters named differently from their table", () => {
    expect(
      messages({
        seedData: seedData("journalEntry", "creditMemo", "debitMemo"),
        attachments: attachments("journal", "memo"),
        interceptor: interceptor("journal", "memo")
      })
    ).toEqual([]);
  });

  it("flags a table attached but missing from the CASE, and the reverse", () => {
    expect(
      messages({
        seedData: seedData(),
        attachments: attachments("quote"),
        interceptor: interceptor("job")
      })
    ).toEqual([
      "attachments.ts: quote",
      "sync_advance_document_sequence.sql: WHEN 'job'"
    ]);
  });
});

const base = (
  overrides: Partial<Record<keyof DeploymentEnvSources, string>> = {}
): DeploymentEnvSources => {
  const contents = {
    sst: `const erp = cluster.addService("CarbonERPService", {
      environment: {
        DOMAIN: process.env.DOMAIN,
        ERP_URL: process.env.ERP_URL,
      },
    });
    const mes = cluster.addService("CarbonMESService", {
      environment: {
        DOMAIN: process.env.DOMAIN,
      },
    });`,
    devEnv: 'lines.push(`DOMAIN=localhost`);\nlines.push("ERP_URL=x");',
    envExample: "SUPABASE_URL=http://localhost\n# COMMENTED=1\n",
    vercel: JSON.stringify({ erp: ["DOMAIN", "ERP_URL"] }),
    ...overrides
  };
  return Object.fromEntries(
    Object.entries(DEPLOYMENT_ENV_FILES).map(([key, file]) => [
      key,
      { file, contents: contents[key as keyof typeof contents] }
    ])
  ) as DeploymentEnvSources;
};

// Stands in for @carbon/env's validation: these two stop startup.
const requires =
  (...names: string[]) =>
  (env: Record<string, string>) =>
    names.filter((name) => !env[name]);

describe("deploymentEnvKeys", () => {
  it("reads each SST service, the local env and each Vercel project", () => {
    expect(
      deploymentEnvKeys(base()).map(({ name, keys }) => [name, keys])
    ).toEqual([
      ["SST CarbonERPService", ["DOMAIN", "ERP_URL"]],
      ["SST CarbonMESService", ["DOMAIN"]],
      ["local crbn up", ["DOMAIN", "ERP_URL", "SUPABASE_URL"]],
      ["Vercel erp", ["DOMAIN", "ERP_URL", "NODE_ENV"]]
    ]);
  });
});

describe("findDeploymentEnvGaps", () => {
  it("accepts a required variable every deployment sets", () => {
    expect(findDeploymentEnvGaps(base(), requires("DOMAIN"))).toEqual([]);
  });

  it("names each deployment that lacks a required variable", () => {
    expect(
      findDeploymentEnvGaps(base(), requires("ERP_URL")).map((v) => v.snippet)
    ).toEqual(["SST CarbonMESService: ERP_URL"]);
  });
});

// Computed with `shasum -a 256`, not by the code under test.
const PAGE = "<p>Offline</p>";
const PAGE_SHA256 =
  "ce53a2ab0e456d4f8189945bf64ba13093c20ead35e8831abc86d76c0454b668";
const EDITED_PAGE = "<p>Offline!</p>";
const EDITED_SHA256 =
  "349ee485babf6eed5f92443d5cc3e4ccbedded9960c07df50b0001f8d176cf04";

const pinned = {
  sha256: PAGE_SHA256,
  caches: { erp: "erp-offline-v5", mes: "mes-shell-v5" }
};

function offlineSources(
  overrides: {
    erpPage?: string;
    mesPage?: string;
    erpWorker?: string;
    mesWorker?: string;
  } = {}
): OfflinePageSources {
  return {
    erp: {
      page: { file: "erp/offline.html", contents: overrides.erpPage ?? PAGE },
      worker: {
        file: "erp/service-worker.js",
        contents:
          overrides.erpWorker ?? 'const OFFLINE_CACHE = "erp-offline-v5";\n'
      }
    },
    mes: {
      page: { file: "mes/offline.html", contents: overrides.mesPage ?? PAGE },
      worker: {
        file: "mes/service-worker.js",
        contents:
          overrides.mesWorker ??
          '// shell\nconst SHELL_CACHE = "mes-shell-v5";\n'
      }
    }
  };
}

const found = (input: OfflinePageSources) =>
  findStaleOfflinePageCaches(input, pinned).map(
    (v) => `${v.file}:${v.line} ${v.snippet}`
  );

describe("findStaleOfflinePageCaches", () => {
  it("accepts the pinned page in both apps with the pinned cache names", () => {
    expect(found(offlineSources())).toEqual([]);
  });

  it("flags an edited page and names the cache names to bump to", () => {
    const violations = findStaleOfflinePageCaches(
      offlineSources({ erpPage: EDITED_PAGE, mesPage: EDITED_PAGE }),
      pinned
    );
    expect(violations.map((v) => `${v.file} ${v.snippet}`)).toEqual([
      `erp/offline.html sha256 ${EDITED_SHA256}`,
      `mes/offline.html sha256 ${EDITED_SHA256}`
    ]);
    expect(violations[0]?.message).toContain(
      'OFFLINE_CACHE in apps/erp/public/service-worker.js to "erp-offline-v6"'
    );
    expect(violations[0]?.message).toContain(
      'SHELL_CACHE in apps/mes/public/service-worker.js to "mes-shell-v6"'
    );
  });

  it("flags a page changed in one app only, so ERP and MES serve the same page", () => {
    expect(found(offlineSources({ mesPage: EDITED_PAGE }))).toEqual([
      `mes/offline.html:1 sha256 ${EDITED_SHA256}`
    ]);
  });

  it("flags a worker whose cache name is not the one pinned with the page", () => {
    expect(
      found(
        offlineSources({
          mesWorker: '// shell\nconst SHELL_CACHE = "mes-shell-v6";\n'
        })
      )
    ).toEqual(['mes/service-worker.js:2 const SHELL_CACHE = "mes-shell-v5";']);
  });
});
