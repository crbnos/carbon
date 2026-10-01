// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { keyOf, loadBaseline } from "./baseline";
import type {
  ConformanceCheck,
  ModuleDir,
  SourceFile,
  StructureCheck,
  Violation
} from "./check";
import { edgeFunctionAuthorizesCaller } from "./conformance/edge-function-authorizes-caller";
import { moduleShape } from "./conformance/module-shape";
import { noAuthzDdlInMigrations } from "./conformance/no-authz-ddl-in-migrations";
import { noDbClientInService } from "./conformance/no-db-client-in-service";
import { noDefaultOnEffects } from "./conformance/no-default-on-effects";
import { noDerivedPercentColumn } from "./conformance/no-derived-percent-column";
import { noInlineFractionDigits } from "./conformance/no-inline-fraction-digits";
import { noIntegrationIdBranching } from "./conformance/no-integration-id-branching";
import { noLegacyRls } from "./conformance/no-legacy-rls";
import { noLocalTimezone } from "./conformance/no-local-timezone";
import { noNumericPrecision } from "./conformance/no-numeric-precision";
import { noRawForwardedHeaders } from "./conformance/no-raw-forwarded-headers";
import { noRawRounding } from "./conformance/no-raw-rounding";
import { noRequiredColumnWithoutDefault } from "./conformance/no-required-column-without-default";
import { noUnguardedSubmit } from "./conformance/no-unguarded-submit";
import { noUnroundedTrackedQuantity } from "./conformance/no-unrounded-tracked-quantity";
import { noUnscopedKyselyWrite } from "./conformance/no-unscoped-kysely-write";
import { noViewWithoutInvoker } from "./conformance/no-view-without-invoker";
import { noZeroConcurrency } from "./conformance/no-zero-concurrency";
import { spdxLicenseHeader } from "./conformance/spdx-license-header";
import { loadEdgeFunctions } from "./sources/edge-functions";
import { loadLicenseFiles } from "./sources/license-files";
import { loadSqlFiles, migrationsDir, repoRoot } from "./sources/migrations";
import { loadModules, modulesDir } from "./sources/modules";
import { loadServerFiles } from "./sources/server-files";
import {
  loadTypescriptFiles,
  REQUEST_HANDLING_ROOTS
} from "./sources/typescript";

export const CONFORMANCE_CHECKS: ConformanceCheck[] = [
  noNumericPrecision,
  noLegacyRls,
  noDerivedPercentColumn,
  noRequiredColumnWithoutDefault,
  noViewWithoutInvoker
];

/** Checks that run over server-side TS, not SQL migrations. */
export const SERVER_CHECKS: ConformanceCheck[] = [
  noLocalTimezone,
  noZeroConcurrency
];

/** Checks that run over ALL app + shared-package TS (client and server). */
export const TS_CHECKS: ConformanceCheck[] = [
  noRawRounding,
  noInlineFractionDigits,
  noDbClientInService,
  noDefaultOnEffects,
  noUnroundedTrackedQuantity,
  noIntegrationIdBranching,
  noUnscopedKyselyWrite,
  noUnguardedSubmit
];

/** Checks that run once per edge function, over all of its .ts files. */
export const EDGE_FUNCTION_CHECKS: ConformanceCheck[] = [
  edgeFunctionAuthorizesCaller
];

export const STRUCTURE_CHECKS: StructureCheck[] = [moduleShape];

export type Finding = { checkId: string; violation: Violation };

export function scanAll(
  files: SourceFile[],
  checks: ConformanceCheck[] = CONFORMANCE_CHECKS
): Finding[] {
  const out: Finding[] = [];
  for (const { file, contents } of files) {
    for (const check of checks) {
      for (const violation of check.scan(file, contents)) {
        out.push({ checkId: check.id, violation });
      }
    }
  }
  return out;
}

export function scanModules(
  modules: ModuleDir[],
  checks: StructureCheck[] = STRUCTURE_CHECKS
): Finding[] {
  const out: Finding[] = [];
  for (const m of modules) {
    for (const check of checks) {
      for (const violation of check.inspect(m)) {
        out.push({ checkId: check.id, violation });
      }
    }
  }
  return out;
}

/** The managed RLS helpers: one packages/database/src/authz/helpers/<name>.sql each. */
export function loadAuthzHelperNames(root: string): string[] {
  return readdirSync(join(root, "packages/database/src/authz/helpers"))
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.replace(/\.sql$/, ""));
}

/** Every finding across the real migrations (text) + modules (structure) + server TS + app TS + edge functions + license headers under `root`. */
export function collectFindings(root: string = repoRoot()): Finding[] {
  return [
    ...scanAll(loadSqlFiles(migrationsDir(root)), [
      ...CONFORMANCE_CHECKS,
      noAuthzDdlInMigrations(loadAuthzHelperNames(root))
    ]),
    ...scanModules(loadModules(modulesDir(root))),
    ...scanAll(loadServerFiles(root), SERVER_CHECKS),
    ...scanAll(loadTypescriptFiles(root), TS_CHECKS),
    ...scanAll(loadTypescriptFiles(root, REQUEST_HANDLING_ROOTS), [
      noRawForwardedHeaders
    ]),
    ...scanAll(loadEdgeFunctions(root), EDGE_FUNCTION_CHECKS),
    ...scanAll(loadLicenseFiles(root), [spdxLicenseHeader])
  ];
}

/** Findings in the real migrations/modules that are NOT grandfathered by the baseline. */
export function newViolations(): Finding[] {
  const baseline = loadBaseline();
  return collectFindings().filter(
    (f) => !baseline.has(keyOf(f.checkId, f.violation))
  );
}
