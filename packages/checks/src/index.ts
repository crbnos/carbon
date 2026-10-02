// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export type {
  ConformanceCheck,
  ModuleDir,
  SourceFile,
  StructureCheck,
  Violation
} from "./check";
export { findClobbers, objectRefs } from "./clobber";
export { edgeFunctionAuthorizesCaller } from "./conformance/edge-function-authorizes-caller";
export { moduleShape } from "./conformance/module-shape";
export { noDbClientInService } from "./conformance/no-db-client-in-service";
export { noDefaultOnEffects } from "./conformance/no-default-on-effects";
export { noDerivedPercentColumn } from "./conformance/no-derived-percent-column";
export { noInlineFractionDigits } from "./conformance/no-inline-fraction-digits";
export { noIntegrationIdBranching } from "./conformance/no-integration-id-branching";
export { noLegacyRls } from "./conformance/no-legacy-rls";
export { noLocalTimezone } from "./conformance/no-local-timezone";
export { noMissingAuditColumn } from "./conformance/no-missing-audit-column";
export { noNumericPrecision } from "./conformance/no-numeric-precision";
export { noRawForwardedHeaders } from "./conformance/no-raw-forwarded-headers";
export { noRawRounding } from "./conformance/no-raw-rounding";
export { noRequiredColumnWithoutDefault } from "./conformance/no-required-column-without-default";
export { noUnguardedSubmit } from "./conformance/no-unguarded-submit";
export { noZeroConcurrency } from "./conformance/no-zero-concurrency";
export { spdxLicenseHeader } from "./conformance/spdx-license-header";
export {
  type Invariant,
  type InvariantResult,
  loadInvariants,
  type Query,
  runInvariants
} from "./invariant";
export {
  applyLicenseHeader,
  classifyFile,
  classifyPath,
  type HeaderStatus,
  inspectLicenseHeader,
  LICENSE_HEADERS,
  type LicenseKind
} from "./license-headers";
export {
  CONFORMANCE_CHECKS,
  collectFindings,
  EDGE_FUNCTION_CHECKS,
  type Finding,
  newViolations,
  SERVER_CHECKS,
  STRUCTURE_CHECKS,
  scanAll,
  scanModules,
  TS_CHECKS
} from "./run";
export { loadDbTableColumns } from "./sources/db-columns";
export { loadEdgeFunctions } from "./sources/edge-functions";
export {
  listLicenseCandidates,
  loadLicenseFiles
} from "./sources/license-files";
export { loadModules, modulesDir } from "./sources/modules";
export { loadServerFiles } from "./sources/server-files";
export { loadTypescriptFiles } from "./sources/typescript";
