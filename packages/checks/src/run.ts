import { keyOf, loadBaseline } from "./baseline";
import type {
  ConformanceCheck,
  ModuleDir,
  SourceFile,
  StructureCheck,
  Violation
} from "./check";
import { moduleShape } from "./conformance/module-shape";
import { noDbClientInService } from "./conformance/no-db-client-in-service";
import { noDerivedPercentColumn } from "./conformance/no-derived-percent-column";
import { noInlineFractionDigits } from "./conformance/no-inline-fraction-digits";
import { noLegacyRls } from "./conformance/no-legacy-rls";
import { noLocalTimezone } from "./conformance/no-local-timezone";
import { noNumericPrecision } from "./conformance/no-numeric-precision";
import { noRawRounding } from "./conformance/no-raw-rounding";
import { noRequiredColumnWithoutDefault } from "./conformance/no-required-column-without-default";
import { noZeroConcurrency } from "./conformance/no-zero-concurrency";
import { loadSqlFiles, migrationsDir, repoRoot } from "./sources/migrations";
import { loadModules, modulesDir } from "./sources/modules";
import { loadServerFiles } from "./sources/server-files";
import { loadTypescriptFiles } from "./sources/typescript";

export const CONFORMANCE_CHECKS: ConformanceCheck[] = [
  noNumericPrecision,
  noLegacyRls,
  noDerivedPercentColumn,
  noRequiredColumnWithoutDefault
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
  noDbClientInService
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

/** Every finding across the real migrations (text) + modules (structure) + server TS + app TS under `root`. */
export function collectFindings(root: string = repoRoot()): Finding[] {
  return [
    ...scanAll(loadSqlFiles(migrationsDir(root))),
    ...scanModules(loadModules(modulesDir(root))),
    ...scanAll(loadServerFiles(root), SERVER_CHECKS),
    ...scanAll(loadTypescriptFiles(root), TS_CHECKS)
  ];
}

/** Findings in the real migrations/modules that are NOT grandfathered by the baseline. */
export function newViolations(): Finding[] {
  const baseline = loadBaseline();
  return collectFindings().filter(
    (f) => !baseline.has(keyOf(f.checkId, f.violation))
  );
}
