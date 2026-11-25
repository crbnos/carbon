// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { basename } from "node:path";
import type { ConformanceCheck } from "../check";
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
import { classifyPath, isLicenseCandidate } from "../license-headers";
import {
  CONFORMANCE_CHECKS,
  loadManagedFunctions,
  SERVER_CHECKS,
  TEST_CHECKS,
  TS_CHECKS
} from "../run";
import { loadAccountReferencePolicy } from "../sources/cross-file";
import { loadSqlFiles, migrationsDir } from "../sources/migrations";
import {
  ERP_MODULES_ROOT,
  ERP_SERVER_SUFFIXES,
  maskClientCode,
  SERVER_ROOTS,
  SERVER_ROUTE_ROOTS
} from "../sources/server-files";
import { isTrackedTestPath } from "../sources/test-files";
import {
  isTest,
  REQUEST_HANDLING_ROOTS,
  ROUTE_ROOTS,
  TYPESCRIPT_ROOTS
} from "../sources/typescript";

/**
 * The files one set of single-file checks reads, as a predicate on one path.
 * Each set mirrors one per-file `scanAll` call in `collectFindings` (run.ts);
 * file-sets.test.ts keeps the predicates equal to the loaders.
 */
export type FileSet = {
  name:
    | "migrations"
    | "server"
    | "typescript"
    | "request-handling"
    | "routes"
    | "untimed-fetch"
    | "license"
    | "tests";
  includes(path: string): boolean;
  /** The `file` a violation carries, which its baseline key uses. */
  violationFile(path: string): string;
  /** The text the checks see: route modules lose their browser half. */
  prepare(path: string, contents: string): string;
  checks(root: string): ConformanceCheck[];
};

const MIGRATIONS_DIR = "packages/database/supabase/migrations/";

const under = (path: string, roots: readonly string[]) =>
  roots.some((root) => path.startsWith(`${root}/`));

const segments = (path: string) => path.split("/");

const hasNodeModules = (path: string) =>
  segments(path).includes("node_modules");

/** The server walk also skips dot directories and dot files. */
const hasDotSegment = (path: string) =>
  segments(path).some((segment) => segment.startsWith("."));

const isTypescriptSource = (path: string) =>
  (path.endsWith(".ts") || path.endsWith(".tsx")) &&
  !isTest(basename(path)) &&
  !hasNodeModules(path);

function isServerFile(path: string): boolean {
  if (hasNodeModules(path) || hasDotSegment(path) || isTest(basename(path))) {
    return false;
  }
  if (under(path, SERVER_ROOTS)) return path.endsWith(".ts");
  if (under(path, [ERP_MODULES_ROOT])) {
    return ERP_SERVER_SUFFIXES.some((suffix) => path.endsWith(suffix));
  }
  if (under(path, SERVER_ROUTE_ROOTS)) {
    return path.endsWith(".ts") || path.endsWith(".tsx");
  }
  return false;
}

const asIs = (_path: string, contents: string) => contents;
const samePath = (path: string) => path;

export const FILE_SETS: FileSet[] = [
  {
    name: "migrations",
    includes: (path) =>
      path.startsWith(MIGRATIONS_DIR) &&
      path.endsWith(".sql") &&
      !path.slice(MIGRATIONS_DIR.length).includes("/"),
    violationFile: (path) => basename(path),
    prepare: asIs,
    checks: (root) => [
      ...CONFORMANCE_CHECKS,
      noAuthzDdlInMigrations(loadManagedFunctions(root)),
      accountFkClassified(loadAccountReferencePolicy(root)),
      tenantFkComposite(
        tenantKeysFromMigrations(loadSqlFiles(migrationsDir(root)))
      )
    ]
  },
  {
    name: "server",
    includes: isServerFile,
    violationFile: samePath,
    prepare: (path, contents) =>
      under(path, SERVER_ROUTE_ROOTS) ? maskClientCode(contents) : contents,
    checks: () => SERVER_CHECKS
  },
  {
    name: "typescript",
    includes: (path) =>
      under(path, TYPESCRIPT_ROOTS) && isTypescriptSource(path),
    violationFile: samePath,
    prepare: asIs,
    // noMissingAuditColumn is left out: it needs the generated column map.
    checks: () => [
      ...TS_CHECKS,
      noRawOrSearch,
      noRawRevalidator,
      noInlineSensorOptions,
      noBareOutlet,
      noStateCopyOfLoaderData,
      formFieldBudget
    ]
  },
  {
    name: "request-handling",
    includes: (path) =>
      under(path, REQUEST_HANDLING_ROOTS) && isTypescriptSource(path),
    violationFile: samePath,
    prepare: asIs,
    checks: () => [
      noRawForwardedHeaders,
      noInterpolatedErrorLog,
      noRawRedirect,
      linguiMacroMisuse
    ]
  },
  {
    name: "routes",
    includes: (path) => under(path, ROUTE_ROOTS) && isTypescriptSource(path),
    violationFile: samePath,
    prepare: asIs,
    checks: () => [indexRedirectBeforeLoaders]
  },
  {
    name: "untimed-fetch",
    includes: (path) =>
      under(path, UNTIMED_FETCH_ROOTS) && isTypescriptSource(path),
    violationFile: samePath,
    prepare: asIs,
    checks: () => [noUntimedFetch]
  },
  {
    name: "license",
    includes: (path) =>
      isLicenseCandidate(path) &&
      !hasNodeModules(path) &&
      !("excluded" in classifyPath(path)),
    violationFile: samePath,
    prepare: asIs,
    checks: () => [spdxLicenseHeader]
  },
  {
    name: "tests",
    includes: (path) => isTrackedTestPath(path) && !hasNodeModules(path),
    violationFile: samePath,
    prepare: asIs,
    checks: () => TEST_CHECKS
  }
];

export function fileSetsFor(path: string): FileSet[] {
  return FILE_SETS.filter((set) => set.includes(path));
}
