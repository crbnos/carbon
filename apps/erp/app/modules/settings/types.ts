// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type {
  BackupCompatibilityStatus,
  CompatibilityFinding,
  ExportRunMeta,
  JobProgress,
  Manifest,
  RestoreRunMeta,
  RowsByTable,
  ScopeViolation,
  TemplateRunMeta
} from "@carbon/jobs/backups";
import type {
  getApiKeys,
  getCompanies,
  getCustomField,
  getCustomFieldsTables,
  getIntegrations,
  getItemSerialSequences,
  getSequences,
  getSubsidiaries,
  getWebhooks
} from "./settings.service";

export type ApiKey = NonNullable<
  Awaited<ReturnType<typeof getApiKeys>>["data"]
>[number];

export type Company = NonNullable<
  Awaited<ReturnType<typeof getCompanies>>["data"]
>[number];

export type CustomField = NonNullable<
  Awaited<ReturnType<typeof getCustomField>>["data"]
>;

export type CustomFieldsTableType = NonNullable<
  Awaited<ReturnType<typeof getCustomFieldsTables>>["data"]
>[number];

export type Integration = NonNullable<
  Awaited<ReturnType<typeof getIntegrations>>["data"]
>[number];

export type Subsidiary = NonNullable<
  Awaited<ReturnType<typeof getSubsidiaries>>["data"]
>[number];

export type Sequence = NonNullable<
  Awaited<ReturnType<typeof getSequences>>["data"]
>[number];

export type ItemSerialSequence = NonNullable<
  Awaited<ReturnType<typeof getItemSerialSequences>>["data"]
>[number];

export type Webhook = NonNullable<
  Awaited<ReturnType<typeof getWebhooks>>["data"]
>[number];

/** An Active make method with a pulled, stocked line missing a Pull From. */
export type MethodMissingPullFrom = {
  makeMethodId: string;
  itemId: string;
  itemType: string;
  readableId: string;
  name: string;
  version: number;
  materials: string[];
  /** The locations at least one of those materials has no Pull From at. */
  locations: string[];
};

/** An open job whose next backflush strict backflush would refuse. */
export type JobMissingStorageUnit = {
  id: string;
  jobId: string;
  status: Database["public"]["Enums"]["jobStatus"];
  readableId: string | null;
  locationName: string | null;
  materials: string[];
};

export type CompanyBackupSummary = {
  /** Backup folder name (also the restore `source` identifier). */
  name: string;
  /** "ready" once manifest.json (the last-written commit marker) exists;
   *  "pending" while the export is still writing the folder. */
  status: "ready" | "pending";
  exportedAt: string | null;
  label: string | null;
  rows: number;
  /** Total bundled asset bytes (the bulk of a backup's footprint). */
  sizeBytes: number;
  /**
   * "Would this backup restore into TODAY's schema?" — computed live on every
   * load, never stored. The hard refusal is still the restore job's gate; this
   * is the same diff, disclosed upfront.
   *
   * `null` when the schema could not be read (database unreachable, pool
   * exhausted). That is "we did not check", NOT "clean" — the row shows no
   * badge and the restore screen says so.
   */
  compatibility: {
    status: BackupCompatibilityStatus;
    findings: CompatibilityFinding[];
  } | null;
  /** Per-edge breakdown of what a `skipCorrupted` export left out; `[]` for a full export. */
  excludedRows: NonNullable<Manifest["excludedRows"]>;
  /** DISTINCT excluded rows per table — sum this, never `excludedRows`. */
  excludedRowsByTable: RowsByTable;
};

/** What every backup job's marker tells the page. */
type CompanyRunView = {
  progress: JobProgress | null;
  startedAt: string | null;
  error: string | null;
  /** "scope-violations" = the company's live data broke the guard; the one failure with a fix. */
  reason: "scope-violations" | null;
  /** Per-edge breakdown for the details popover. */
  violations: ScopeViolation[];
  /** DISTINCT rows per table — sum this for anything a user reads. */
  violationRowsByTable: RowsByTable;
};

export type CompanyRestoreRun = CompanyRunView & {
  restoreRunId: string;
  status: RestoreRunMeta["status"];
  rows: number;
  label: string | null;
  /** What it restored, so a recovery action can restart the same restore. */
  filePath: string | null;
  includeStorage: "none" | "all" | null;
};

export type CompanyExportRun = CompanyRunView & {
  status: ExportRunMeta["status"];
  /** What the failed run asked for, so the retry can reuse it. */
  label: string | null;
  includeStorage: "none" | "all" | null;
};

export type CompanyTemplateRun = CompanyRunView & {
  templateRunId: string;
  status: TemplateRunMeta["status"];
  datasetKey: string | null;
  /** Whether a pre-apply snapshot exists, so the page offers a revert only
   *  when there is something to put back. */
  hasSnapshot: boolean;
};
