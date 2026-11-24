// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export type {
  Check,
  ConformanceCheck,
  ModuleDir,
  Provenance,
  Repo,
  SourceFile,
  StructureCheck,
  Violation
} from "./check";
export { eachFile, fileCheck } from "./check";
export { CHECKS } from "./checks";
export { findClobbers, objectRefs } from "./clobber";
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
export { openRepo } from "./repo";
export {
  collectFindings,
  type Finding,
  newViolations,
  runChecks
} from "./run";
