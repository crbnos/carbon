export type {
  ConformanceCheck,
  ModuleDir,
  StructureCheck,
  Violation
} from "./check";
export { findClobbers, objectRefs, type SourceFile } from "./clobber";
export { moduleShape } from "./conformance/module-shape";
export { noLegacyRls } from "./conformance/no-legacy-rls";
export { noNumericPrecision } from "./conformance/no-numeric-precision";
export {
  type Invariant,
  type InvariantResult,
  loadInvariants,
  type Query,
  runInvariants
} from "./invariant";
export {
  CONFORMANCE_CHECKS,
  collectFindings,
  type Finding,
  newViolations,
  STRUCTURE_CHECKS,
  scanAll,
  scanModules
} from "./run";
export { loadModules, modulesDir } from "./sources/modules";
