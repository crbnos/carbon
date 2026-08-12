import { keyOf, loadBaseline } from "./baseline";
import type {
  ConformanceCheck,
  ModuleDir,
  StructureCheck,
  Violation
} from "./check";
import { moduleShape } from "./conformance/module-shape";
import { noLegacyRls } from "./conformance/no-legacy-rls";
import { noLocalTimezone } from "./conformance/no-local-timezone";
import { noNumericPrecision } from "./conformance/no-numeric-precision";
import { noZeroConcurrency } from "./conformance/no-zero-concurrency";
import {
  loadSqlFiles,
  migrationsDir,
  repoRoot,
  type SqlFile
} from "./sources/migrations";
import { loadModules, modulesDir } from "./sources/modules";
import { loadServerFiles } from "./sources/server-files";

export const CONFORMANCE_CHECKS: ConformanceCheck[] = [
  noNumericPrecision,
  noLegacyRls
];

/** Checks that run over server-side TS, not SQL migrations. */
export const SERVER_CHECKS: ConformanceCheck[] = [
  noLocalTimezone,
  noZeroConcurrency
];

export const STRUCTURE_CHECKS: StructureCheck[] = [moduleShape];

export type Finding = { checkId: string; violation: Violation };

export function scanAll(
  files: SqlFile[],
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

/** Every finding across the real migrations (text) + modules (structure) + server TS under `root`. */
export function collectFindings(root: string = repoRoot()): Finding[] {
  return [
    ...scanAll(loadSqlFiles(migrationsDir(root))),
    ...scanModules(loadModules(modulesDir(root))),
    ...scanAll(loadServerFiles(root), SERVER_CHECKS)
  ];
}

/** Findings in the real migrations/modules that are NOT grandfathered by the baseline. */
export function newViolations(): Finding[] {
  const baseline = loadBaseline();
  return collectFindings().filter(
    (f) => !baseline.has(keyOf(f.checkId, f.violation))
  );
}
