// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// `@carbon/jobs/backups`: what the ERP uses of the backup engine.
export { getCompanyTableCatalog, selectExportableTables } from "./catalog";
export {
  type BackupCompatibilityStatus,
  type CompatibilityFinding,
  compatibilityStatus,
  reportBackupCompatibility
} from "./compatibility";
export { rebuildDerivedGroups } from "./derived-groups";
export {
  backupDir,
  isSnapshotName,
  type Manifest,
  newBackupName
} from "./format";
export {
  EXPORT_INTEGRATION,
  type ExportRunMeta,
  type JobProgress,
  RESTORE_INTEGRATION,
  type RestoreRunMeta,
  type RowsByTable,
  TEMPLATE_INTEGRATION,
  type TemplateRunMeta
} from "./runs";
export { purgeScopeViolations, type ScopeViolation } from "./scope";
export {
  deleteCompanyFiles,
  listBackups,
  listCompanyFiles
} from "./storage";
