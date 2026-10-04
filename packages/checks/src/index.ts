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
export { indexRedirectBeforeLoaders } from "./conformance/index-redirect-before-loaders";
export { moduleShape } from "./conformance/module-shape";
export { noDbClientInService } from "./conformance/no-db-client-in-service";
export { noDefaultOnEffects } from "./conformance/no-default-on-effects";
export { noDerivedPercentColumn } from "./conformance/no-derived-percent-column";
export { noInlineFractionDigits } from "./conformance/no-inline-fraction-digits";
export { noIntegrationIdBranching } from "./conformance/no-integration-id-branching";
export { noInterpolatedErrorLog } from "./conformance/no-interpolated-error-log";
export { noLegacyRls } from "./conformance/no-legacy-rls";
export { noLocalTimezone } from "./conformance/no-local-timezone";
export { noMissingAuditColumn } from "./conformance/no-missing-audit-column";
export { noNumericPrecision } from "./conformance/no-numeric-precision";
export { noRawForwardedHeaders } from "./conformance/no-raw-forwarded-headers";
export { noRawRedirect } from "./conformance/no-raw-redirect";
export { noRawRounding } from "./conformance/no-raw-rounding";
export { noRequiredColumnWithoutDefault } from "./conformance/no-required-column-without-default";
export { noUnguardedSubmit } from "./conformance/no-unguarded-submit";
export { noZeroConcurrency } from "./conformance/no-zero-concurrency";
export { serverFnAuthorizesCaller } from "./conformance/server-fn-authorizes-caller";
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
  SERVER_FN_CHECKS,
  STRUCTURE_CHECKS,
  scanAll,
  scanModules,
  TS_CHECKS
} from "./run";
export { loadDbTableColumns } from "./sources/db-columns";
export {
  loadEdgeFunctions,
  loadServerFunctions
} from "./sources/edge-functions";
export {
  listLicenseCandidates,
  loadLicenseFiles
} from "./sources/license-files";
export { loadModules, modulesDir } from "./sources/modules";
export { loadServerFiles } from "./sources/server-files";
export { loadTypescriptFiles } from "./sources/typescript";
