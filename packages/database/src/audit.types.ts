import type { AuditableTable, AuditEntityType } from "./audit.config";

/**
 * Operation types for audit log entries
 */
export type AuditOperation = "INSERT" | "UPDATE" | "DELETE";

/**
 * Metadata captured with each audit log entry
 */
export interface AuditMetadata {
  ipAddress?: string;
  userAgent?: string;
  origin?: "web" | "api" | "import" | "system";
  requestId?: string;
}

/**
 * Represents a single field change in the diff.
 *
 * Both `old` and `new` are optional: INSERT entries populated via a table's
 * `createFields` config only include `new`, and the UI hides the "old" pill
 * when the key is absent.
 *
 * `snapshot` carries frozen values from the FK target row for columns
 * declared in `snapshotFields`. Captured at write time so the row is
 * self-contained — renaming or deleting the FK target later does not
 * rewrite history. The nested `old` / `new` mirrors the parent's old/new
 * pair, recursively. Each key inside `snapshot.old` / `snapshot.new`
 * corresponds to one column listed in `displayColumns`. The renderer
 * switches presentation based on key count: a single key renders inline;
 * multiple keys render as an expanded section.
 */
export interface AuditDiffEntry {
  old?: unknown;
  new?: unknown;
  snapshot?: {
    old?: Record<string, unknown>;
    new?: Record<string, unknown>;
  };
}

/**
 * The diff object showing what changed
 * Keys are field names (can be nested like "customFields.myField")
 */
export type AuditDiff = Record<string, AuditDiffEntry>;

/**
 * A single audit log entry as stored in the database
 */
export interface AuditLogEntry {
  id: string;
  companyId: string;
  tableName: AuditableTable;
  entityType: AuditEntityType;
  entityId: string;
  /**
   * The raw PK of the row that triggered this entry.
   * For root tables, recordId == entityId. For child tables they differ
   * (e.g. entityId = parent id, recordId = child row id). Nullable to
   * tolerate legacy rows inserted before the column was added.
   */
  recordId: string | null;
  operation: AuditOperation;
  actorId: string | null;
  diff: AuditDiff | null;
  metadata: AuditMetadata | null;
  createdAt: string;
}

/**
 * Input for creating an audit log entry
 * Note: companyId is passed separately to the RPC function
 */
export interface CreateAuditLogEntry {
  tableName: AuditableTable;
  entityType: AuditEntityType;
  entityId: string;
  recordId: string;
  operation: AuditOperation;
  actorId: string | null;
  diff?: AuditDiff | null;
  metadata?: AuditMetadata | null;
  createdAt?: string;
}

/**
 * Filters for querying audit logs
 */
export interface AuditLogFilters {
  entityType?: AuditEntityType;
  actorId?: string;
  operation?: AuditOperation;
  startDate?: string;
  endDate?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Response from getGlobalAuditLog with pagination info
 */
export interface AuditLogResponse {
  data: AuditLogEntry[];
  count: number;
}

/**
 * An archived audit log period
 */
export interface AuditLogArchive {
  id: string;
  companyId: string;
  archivePath: string;
  startDate: string;
  endDate: string;
  rowCount: number;
  sizeBytes: number | null;
  createdAt: string;
}

/**
 * Configuration for enabling audit logs
 */
export interface AuditLogConfig {
  enabled: boolean;
}
