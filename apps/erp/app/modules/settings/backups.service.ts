import type { Database } from "@carbon/database";
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
};

/**
 * List a company's backups (the `exports/<name>/` folders, snapshots excluded),
 * reading each manifest for its metadata. Manifests are tiny, so the per-backup
 * reads run in parallel.
 */
export async function listCompanyBackups(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{ data: CompanyBackupSummary[] | null; error: Error | null }> {
  const { data, error } = await client.storage
    .from(companyId)
    .list("exports", { limit: 100 });
  if (error) return { data: null, error };

  const folders = (data ?? []).filter(
    (e) => e.id === null && !e.name.startsWith(SNAPSHOT_PREFIX)
  );

  const backups = await Promise.all(
    folders.map(async (folder): Promise<CompanyBackupSummary> => {
      const summary: CompanyBackupSummary = {
        name: folder.name,
        status: "pending",
        exportedAt: null,
        label: null,
        rows: 0,
        sizeBytes: 0
      };
      const mf = await client.storage
        .from(companyId)
        .download(`exports/${folder.name}/manifest.json`);
      if (mf.data) {
        try {
          const m = JSON.parse(await mf.data.text()) as {
            exportedAt?: string;
            label?: string | null;
            tables?: Array<{ rows?: number }>;
            storage?: Array<{ size?: number; included?: boolean }>;
          };
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
        } catch {
          // Manifest present but unreadable — treat as a partial/aborted export
          // (stays "pending"); still listed by name so the user can delete it.
        }
      }
      return summary;
    })
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
    };
    return {
      restoreRunId: meta.restoreRunId ?? m.entityId,
      status: meta.status ?? "running",
      rows: meta.rows ?? 0,
      label: meta.label ?? null,
      error: meta.error ?? null,
      progress: meta.progress ?? null,
      startedAt: meta.startedAt ?? m.createdAt
    };
  });

  return { data: runs, error: null };
}

/**
 * The in-flight export's live progress, or null when none is running. One marker
 * per company (integration = 'company-export'), written by the export job and
 * cleared when it finishes — so its absence means "not running" (the new backup
 * appearing in the list is what signals completion).
 */
export async function getCompanyExportRun(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{
  data: {
    progress: { phase: string; done: number; total: number } | null;
    startedAt: string | null;
  } | null;
  error: Error | null;
}> {
  const marker = await client
    .from("externalIntegrationMapping")
    .select("metadata, createdAt")
    .eq("integration", "company-export")
    .eq("companyId", companyId)
    .maybeSingle();

  if (marker.error) return { data: null, error: marker.error };
  if (!marker.data) return { data: null, error: null };

  const meta = (marker.data.metadata ?? {}) as {
    startedAt?: string;
    progress?: { phase: string; done: number; total: number };
  };
  return {
    data: {
      progress: meta.progress ?? null,
      startedAt: meta.startedAt ?? marker.data.createdAt
    },
    error: null
  };
}
