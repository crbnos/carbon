// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { accountFkClassified } from "../conformance/account-fk-restrict";
import { formFieldBudget } from "../conformance/form-field-budget";
import { indexRedirectBeforeLoaders } from "../conformance/index-redirect-before-loaders";
import { linguiMacroMisuse } from "../conformance/lingui-macro-misuse";
import { noAuthzDdlInMigrations } from "../conformance/no-authz-ddl-in-migrations";
import { noBareOutlet } from "../conformance/no-bare-outlet";
import { noInlineSensorOptions } from "../conformance/no-inline-sensor-options";
import { noInterpolatedErrorLog } from "../conformance/no-interpolated-error-log";
import { noRawForwardedHeaders } from "../conformance/no-raw-forwarded-headers";
import { noRawOrSearch } from "../conformance/no-raw-or-search";
import { noRawRedirect } from "../conformance/no-raw-redirect";
import { noRawRevalidator } from "../conformance/no-raw-revalidator";
import { noStateCopyOfLoaderData } from "../conformance/no-state-copy-of-loader-data";
import {
  noUntimedFetch,
  UNTIMED_FETCH_ROOTS
} from "../conformance/no-untimed-fetch";
import { spdxLicenseHeader } from "../conformance/spdx-license-header";
import {
  tenantFkComposite,
  tenantKeysFromMigrations
} from "../conformance/tenant-fk-composite";
import {
  CONFORMANCE_CHECKS,
  loadManagedFunctions,
  SERVER_CHECKS,
  TEST_CHECKS,
  TS_CHECKS
} from "../run";
import { loadAccountReferencePolicy } from "../sources/cross-file";
import { loadLicenseFiles } from "../sources/license-files";
import { loadSqlFiles, migrationsDir, repoRoot } from "../sources/migrations";
import { loadServerFiles } from "../sources/server-files";
import { loadTestFiles } from "../sources/test-files";
import {
  loadTypescriptFiles,
  REQUEST_HANDLING_ROOTS,
  ROUTE_ROOTS
} from "../sources/typescript";
import { FILE_SETS, type FileSet } from "./file-sets";

const root = repoRoot();
const set = (name: FileSet["name"]) => {
  const found = FILE_SETS.find((s) => s.name === name);
  if (!found) throw new Error(`No file set ${name}`);
  return found;
};

describe("FILE_SETS matches the loaders the gate scans", () => {
  const cases: [FileSet["name"], string[]][] = [
    [
      "migrations",
      loadSqlFiles(migrationsDir(root)).map(
        (f) => `packages/database/supabase/migrations/${f.file}`
      )
    ],
    ["server", loadServerFiles(root).map((f) => f.file)],
    ["typescript", loadTypescriptFiles(root).map((f) => f.file)],
    [
      "request-handling",
      loadTypescriptFiles(root, REQUEST_HANDLING_ROOTS).map((f) => f.file)
    ],
    ["routes", loadTypescriptFiles(root, ROUTE_ROOTS).map((f) => f.file)],
    [
      "untimed-fetch",
      loadTypescriptFiles(root, UNTIMED_FETCH_ROOTS).map((f) => f.file)
    ],
    ["license", loadLicenseFiles(root).map((f) => f.file)],
    ["tests", loadTestFiles(root).map((f) => f.file)]
  ];

  it.each(cases)("%s includes every file its loader returns", (name, files) => {
    expect(files.length).toBeGreaterThan(0);
    const fileSet = set(name);
    expect(files.filter((file) => !fileSet.includes(file))).toEqual([]);
  });
});

describe("FILE_SETS excludes files outside each set", () => {
  const outside: [FileSet["name"], string][] = [
    ["migrations", "packages/database/supabase/migrations/nested/a.sql"],
    ["migrations", "packages/database/src/a.sql"],
    ["server", "apps/erp/app/modules/sales/ui/Card.tsx"],
    ["server", "packages/jobs/src/a.test.ts"],
    ["typescript", "apps/erp/app/routes/x+/a.test.tsx"],
    ["typescript", "packages/ee/node_modules/x/a.ts"],
    ["request-handling", "packages/react/src/Button.tsx"],
    ["routes", "apps/erp/app/modules/sales/sales.server.ts"],
    ["untimed-fetch", "packages/react/src/Button.tsx"],
    ["license", "docs/README.md"],
    ["tests", "packages/checks/src/run.test.ts"],
    ["tests", "apps/erp/app/modules/sales/sales.service.ts"]
  ];

  it.each(outside)("%s does not include %s", (name, path) => {
    expect(set(name).includes(path)).toBe(false);
  });
});

it("holds exactly the single-file checks the gate runs", () => {
  const gateIds = [
    ...CONFORMANCE_CHECKS,
    noAuthzDdlInMigrations(loadManagedFunctions(root)),
    accountFkClassified(loadAccountReferencePolicy(root)),
    tenantFkComposite(
      tenantKeysFromMigrations(loadSqlFiles(migrationsDir(root)))
    ),
    ...SERVER_CHECKS,
    ...TS_CHECKS,
    noRawOrSearch,
    noRawRevalidator,
    noInlineSensorOptions,
    noBareOutlet,
    noStateCopyOfLoaderData,
    formFieldBudget,
    noRawForwardedHeaders,
    noInterpolatedErrorLog,
    noRawRedirect,
    linguiMacroMisuse,
    indexRedirectBeforeLoaders,
    noUntimedFetch,
    spdxLicenseHeader,
    ...TEST_CHECKS
  ].map((check) => check.id);
  const setIds = FILE_SETS.flatMap((s) => s.checks(root)).map((c) => c.id);
  expect(setIds.sort()).toEqual(gateIds.sort());
});
