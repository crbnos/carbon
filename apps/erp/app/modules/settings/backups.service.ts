import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

// Company backup data access. The export edge function is a thin auth boundary;
// the heavy lifting runs in the carbon/company-export inngest job. Restore is
// enqueued server-side (see backups.server.ts) and tracked via the
// externalIntegrationMapping marker (getCompanyRestoreRuns).

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

export async function listCompanyBackupExports(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.storage.from(companyId).list("exports", {
    limit: 25,
    sortBy: { column: "created_at", order: "desc" }
  });
}

export async function getCompanyBackupSignedUrl(
  client: SupabaseClient<Database>,
  companyId: string,
  filePath: string
) {
  return client.storage.from(companyId).createSignedUrl(filePath, 60 * 60);
}

export async function deleteCompanyBackupExport(
  client: SupabaseClient<Database>,
  companyId: string,
  filePath: string
) {
  return client.storage.from(companyId).remove([filePath]);
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
    };
    return {
      restoreRunId: meta.restoreRunId ?? m.entityId,
      status: meta.status ?? "running",
      rows: meta.rows ?? 0,
      label: meta.label ?? null,
      error: meta.error ?? null,
      startedAt: m.createdAt
    };
  });

  return { data: runs, error: null };
}
