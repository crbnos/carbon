import type { Database } from "@carbon/database";
import type {
  BackupCompatibilityStatus,
  CompatibilityFinding,
  Manifest
} from "@carbon/jobs/backups";
import type { SupabaseClient } from "@supabase/supabase-js";

// Company backup data access. The export edge function is a thin auth boundary;
// the heavy lifting runs in the carbon/company-export inngest job. Restore is
// enqueued server-side (see backups.server.ts) and tracked via the
// externalIntegrationMapping marker (getCompanyRestoreRuns).

// A backup is a folder `exports/<name>/` of small objects: `manifest.json`, one
// `tables/<table>.ndjson.gz` per table, and `assets/<path>` files. Pre-restore
// snapshots use the same layout under a `_pre-restore-*` name. Must match the
// `backup*Path` helpers in packages/jobs/.../company-backup.ts.
const SNAPSHOT_PREFIX = "_pre-restore-";

/**
 * One FK edge whose rows escape company scope, as the export/restore jobs record
 * it in their failure marker. Typed here rather than imported from `@carbon/jobs`
 * — the app must not pull job internals (and Node `Buffer` with them) into its
 * bundle.
 */
export type ScopeViolationSummary = {
  table: string;
  column: string;
  refTable: string;
  rows: number;
};

/** DISTINCT rows per table. The ONLY shape a user-facing total may be summed from. */
export type RowsByTable = { table: string; rows: number };

/**
 * How many ROWS a skip or purge affects. `violations`/`excludedRows` are per FK
 * EDGE — a row escaping scope through three of its foreign keys appears three
 * times there — so totals must come from the per-table distinct counts.
 */
export function totalScopeRows(rowsByTable: RowsByTable[]): number {
  return rowsByTable.reduce((sum, t) => sum + t.rows, 0);
}

/** Supabase storage caps a `list` call; page until a short page comes back. */
const BACKUP_LIST_PAGE_SIZE = 100;
const BACKUP_LIST_MAX_PAGES = 50;

/**
 * Remove every object under a prefix (recursing into folders) so a deleted
 * backup actually releases its bucket space rather than orphaning files.
 */
async function removeStoragePrefix(
  client: SupabaseClient<Database>,
  bucket: string,
  prefix: string
) {
  const { data } = await client.storage
    .from(bucket)
    .list(prefix, { limit: 1000 });
  if (!data) return;
  const files: string[] = [];
  for (const entry of data) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      await removeStoragePrefix(client, bucket, path);
    } else {
      files.push(path);
    }
  }
  if (files.length > 0) {
    await client.storage.from(bucket).remove(files);
  }
}

export async function exportCompanyBackup(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    userId: string;
    label?: string;
    includeStorage?: "none" | "all";
    /** Opt-in recovery: leave out rows whose links escape company scope. */
    skipCorrupted?: boolean;
  }
) {
  return client.functions.invoke("export-company", { body: args });
}

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
   * "Would this backup restore into TODAY's schema?" — computed live against
   * the current schema by `getCompanyBackups` (backups.server.ts) on every
   * load, never stored. The hard refusal is still `assertBackupImportable`
   * inside the restore job; this is the same diff, disclosed upfront.
   *
   * `null` when the schema could not be read (database unreachable, pool
   * exhausted). That is "we did not check", NOT "clean" — the row shows no
   * badge and the restore screen says so. Never substitute a `ready` verdict
   * here: claiming a backup is restorable without comparing anything is the
   * exact failure this whole computation replaced.
   */
  compatibility: {
    status: BackupCompatibilityStatus;
    findings: CompatibilityFinding[];
  } | null;
  /** Per-edge breakdown of what a `skipCorrupted` export left out; `[]` for a full export. */
  excludedRows: NonNullable<Manifest["excludedRows"]>;
  /** DISTINCT excluded rows per table — sum this, never `excludedRows`. */
  excludedRowsByTable: RowsByTable[];
};

/**
 * List a company's backup folders (`exports/<name>/`, snapshots excluded),
 * reading each manifest for its metadata. Storage layer only: `compatibility`
 * is a placeholder here — `getCompanyBackups` in backups.server.ts computes
 * the real verdict from the returned `manifest` (server-only, since it needs
 * `@carbon/jobs/backups` and a schema read) and strips it before the loader
 * returns.
 */
export async function listCompanyBackupFolders(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{
  data: (CompanyBackupSummary & { manifest: Manifest | null })[] | null;
  error: Error | null;
}> {
  // Paged: storage caps a list call, and an un-listed backup can be neither
  // restored nor deleted. The page cap only guards a misbehaving storage
  // response from looping forever.
  const entries: Awaited<
    ReturnType<ReturnType<typeof client.storage.from>["list"]>
  >["data"] = [];
  for (let page = 0; page < BACKUP_LIST_MAX_PAGES; page++) {
    const { data, error } = await client.storage
      .from(companyId)
      .list("exports", {
        limit: BACKUP_LIST_PAGE_SIZE,
        offset: page * BACKUP_LIST_PAGE_SIZE
      });
    if (error) return { data: null, error };
    entries.push(...(data ?? []));
    if ((data?.length ?? 0) < BACKUP_LIST_PAGE_SIZE) break;
  }

  const folders = entries.filter(
    (e) => e.id === null && !e.name.startsWith(SNAPSHOT_PREFIX)
  );

  const backups = await Promise.all(
    folders.map(
      async (
        folder
      ): Promise<CompanyBackupSummary & { manifest: Manifest | null }> => {
        const summary: CompanyBackupSummary & { manifest: Manifest | null } = {
          name: folder.name,
          status: "pending",
          exportedAt: null,
          label: null,
          rows: 0,
          sizeBytes: 0,
          compatibility: null,
          excludedRows: [],
          excludedRowsByTable: [],
          manifest: null
        };
        const mf = await client.storage
          .from(companyId)
          .download(`exports/${folder.name}/manifest.json`);
        if (mf.data) {
          try {
            const m = JSON.parse(await mf.data.text()) as Manifest;
            summary.status = "ready";
            summary.exportedAt = m.exportedAt ?? null;
            summary.label = m.label ?? null;
            summary.rows = (m.tables ?? []).reduce(
              (sum, t) => sum + (t.rows ?? 0),
              0
            );
            summary.sizeBytes = (m.storage ?? [])
              .filter((x) => x.included)
              .reduce((sum, x) => sum + (x.size ?? 0), 0);
            summary.excludedRows = m.excludedRows ?? [];
            summary.excludedRowsByTable = m.excludedRowsByTable ?? [];
            summary.manifest = { ...m, tables: m.tables ?? [] };
          } catch {
            // Manifest present but unreadable — treat as a partial/aborted
            // export (stays "pending"); still listed so the user can delete it.
          }
        }
        return summary;
      }
    )
  );

  backups.sort((a, b) =>
    (b.exportedAt ?? "").localeCompare(a.exportedAt ?? "")
  );
  return { data: backups, error: null };
}

/** Delete a backup — the whole `exports/<name>/` folder (data + manifest + assets). */
export async function deleteCompanyBackup(
  client: SupabaseClient<Database>,
  companyId: string,
  name: string
) {
  await removeStoragePrefix(client, companyId, `exports/${name}`);
  return { error: null as Error | null };
}

/**
 * Pending in-place restore runs. One marker row per restore (integration =
 * 'company-restore'), holding the pre-restore snapshot path in metadata. A row
 * exists between the restore completing and the user keeping or reverting it.
 */
export async function getCompanyRestoreRuns(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const markers = await client
    .from("externalIntegrationMapping")
    .select("entityId, metadata, createdAt")
    .eq("integration", "company-restore")
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });

  if (markers.error) return { data: null, error: markers.error };

  const runs = (markers.data ?? []).map((m) => {
    const meta = (m.metadata ?? {}) as {
      restoreRunId?: string;
      status?: "running" | "ready" | "failed" | "reverting";
      rows?: number;
      label?: string | null;
      error?: string | null;
      startedAt?: string;
      progress?: { phase: string; done: number; total: number };
      filePath?: string;
      includeStorage?: "none" | "all";
      reason?: "scope-violations";
      violations?: ScopeViolationSummary[];
      violationRowsByTable?: RowsByTable[];
    };
    return {
      restoreRunId: meta.restoreRunId ?? m.entityId,
      status: meta.status ?? "running",
      rows: meta.rows ?? 0,
      label: meta.label ?? null,
      error: meta.error ?? null,
      progress: meta.progress ?? null,
      startedAt: meta.startedAt ?? m.createdAt,
      // Why it failed + what it was restoring, so the recovery action can
      // restart the same restore once the live data is fixed.
      reason: meta.reason ?? null,
      violations: meta.violations ?? [],
      violationRowsByTable: meta.violationRowsByTable ?? [],
      filePath: meta.filePath ?? null,
      includeStorage: meta.includeStorage ?? null
    };
  });

  return { data: runs, error: null };
}

/**
 * The one-per-company marker row for a long-running job, or null when none.
 * Shared by the export and demo-template readers below: both are a single row
 * keyed on `integration`, whose `metadata` JSON the job owns. `createdAt` comes
 * back too, as the fallback for a marker written before its first heartbeat.
 */
async function readIntegrationMarker(
  client: SupabaseClient<Database>,
  companyId: string,
  integration: "company-export" | "company-template"
): Promise<{
  data: { meta: Record<string, unknown>; createdAt: string } | null;
  error: Error | null;
}> {
  const marker = await client
    .from("externalIntegrationMapping")
    .select("metadata, createdAt")
    .eq("integration", integration)
    .eq("companyId", companyId)
    .maybeSingle();

  if (marker.error) return { data: null, error: marker.error };
  if (!marker.data) return { data: null, error: null };

  return {
    data: {
      meta: (marker.data.metadata ?? {}) as Record<string, unknown>,
      createdAt: marker.data.createdAt
    },
    error: null
  };
}

export type CompanyExportRun = {
  status: "running" | "failed";
  progress: { phase: string; done: number; total: number } | null;
  startedAt: string | null;
  error: string | null;
  /** "scope-violations" = the closure guard refused; the only failure with a skip recovery. */
  reason: "scope-violations" | null;
  /** Per-edge breakdown for the details popover. */
  violations: ScopeViolationSummary[];
  /** DISTINCT rows per table — sum this for anything a user reads. */
  violationRowsByTable: RowsByTable[];
  /** What the failed run asked for, so the retry can reuse it. */
  label: string | null;
  includeStorage: "none" | "all" | null;
};

/**
 * The current export marker, or null when none. One marker per company
 * (integration = 'company-export'), written by the export job: absent = not
 * running (the new backup appearing in the list is what signals completion),
 * "running" = in flight, "failed" = the last export died and the user hasn't
 * dismissed it yet.
 */
export async function getCompanyExportRun(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{
  data: CompanyExportRun | null;
  error: Error | null;
}> {
  const marker = await readIntegrationMarker(
    client,
    companyId,
    "company-export"
  );
  if (marker.error || !marker.data) return { data: null, error: marker.error };

  const meta = marker.data.meta as {
    status?: "running" | "failed";
    startedAt?: string;
    progress?: { phase: string; done: number; total: number };
    error?: string;
    reason?: "scope-violations";
    violations?: ScopeViolationSummary[];
    violationRowsByTable?: RowsByTable[];
    label?: string | null;
    includeStorage?: "none" | "all";
  };
  return {
    data: {
      status: meta.status ?? "running",
      progress: meta.progress ?? null,
      startedAt: meta.startedAt ?? marker.data.createdAt,
      error: meta.error ?? null,
      reason: meta.reason ?? null,
      violations: meta.violations ?? [],
      violationRowsByTable: meta.violationRowsByTable ?? [],
      label: meta.label ?? null,
      includeStorage: meta.includeStorage ?? null
    },
    error: null
  };
}

export type CompanyTemplateRun = {
  templateRunId: string;
  status: "running" | "ready" | "failed" | "reverting";
  datasetKey: string | null;
  startedAt: string | null;
  error: string | null;
  /** Phase + done/total while the apply or revert is in flight. */
  progress: { phase: string; done: number; total: number } | null;
  /** Whether a pre-apply snapshot exists yet — the UI offers a revert retry on a
   *  stalled run only when there is actually something to put back. */
  hasSnapshot: boolean;
};

/**
 * The current demo-template marker, or null when none. Written by the
 * company-template job: absent = no demo data change is outstanding, "running" =
 * in flight, "ready" = applied and waiting on a keep/revert decision,
 * "reverting" = the undo is in flight, "failed" = it did not land and the user
 * hasn't dismissed it yet.
 *
 * The metadata shape is typed here rather than imported from `@carbon/jobs` —
 * the app must not pull job internals (and Node `Buffer` with them) into its
 * bundle.
 */
export async function getCompanyTemplateRun(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{
  data: CompanyTemplateRun | null;
  error: Error | null;
}> {
  const marker = await readIntegrationMarker(
    client,
    companyId,
    "company-template"
  );
  if (marker.error || !marker.data) return { data: null, error: marker.error };

  const meta = marker.data.meta as {
    templateRunId?: string;
    status?: "running" | "ready" | "failed" | "reverting";
    datasetKey?: string;
    startedAt?: string;
    error?: string;
    progress?: { phase: string; done: number; total: number } | null;
    snapshotPath?: string;
  };

  // Only whether a snapshot EXISTS is projected, never where — the job owns its
  // lifecycle end to end, and the client has no use for the location.
  return {
    data: {
      templateRunId: meta.templateRunId ?? "",
      status: meta.status ?? "running",
      datasetKey: meta.datasetKey ?? null,
      startedAt: meta.startedAt ?? marker.data.createdAt,
      error: meta.error ?? null,
      progress: meta.progress ?? null,
      hasSnapshot: Boolean(meta.snapshotPath)
    },
    error: null
  };
}
