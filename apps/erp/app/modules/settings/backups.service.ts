import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

// Company backup export/import. Edge functions are thin auth boundaries;
// the heavy lifting runs in the carbon/company-export and
// carbon/company-import inngest jobs (packages/jobs).

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

export async function importCompanyBackup(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    userId: string;
    filePath: string;
    mode?: "preserve" | "reseed";
  }
) {
  return client.functions.invoke<{ importRunId: string }>("import-company", {
    body: args
  });
}

export async function finalizeCompanyBackupImport(
  client: SupabaseClient<Database>,
  args: { companyId: string; importRunId: string; userId: string }
) {
  return client.functions.invoke("finalize-import", { body: args });
}

export async function revertCompanyBackupImport(
  client: SupabaseClient<Database>,
  args: { companyId: string; importRunId: string; userId: string }
) {
  return client.functions.invoke("revert-import", { body: args });
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
 * Load modelUpload rows created by the given import run that still need a
 * thumbnail rendered. Used to fan out `model-thumbnail` jobs when an import
 * is finalized so the imported models get previews.
 */
export async function getCompanyBackupImportedModels(
  client: SupabaseClient<Database>,
  args: { companyId: string; importRunId: string }
) {
  const mappings = await client
    .from("externalIntegrationMapping")
    .select("entityId")
    .eq("integration", "company-backup")
    .eq("entityType", "modelUpload")
    .eq("companyId", args.companyId)
    .filter("metadata->>importRunId", "eq", args.importRunId);

  if (mappings.error) return mappings;

  const ids = (mappings.data ?? []).map((m) => m.entityId);
  if (ids.length === 0) return { data: [], error: null };

  return client
    .from("modelUpload")
    .select("id, thumbnailPath, modelPath")
    .in("id", ids)
    .not("modelPath", "is", null)
    .is("thumbnailPath", null);
}

/**
 * Pending company backup import runs, derived from the revert ledger.
 * Rows exist between import-company and finalize/revert.
 */
export async function getCompanyBackupImportRuns(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const mappings = await client
    .from("externalIntegrationMapping")
    .select("metadata, createdAt")
    .eq("integration", "company-backup")
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true })
    .limit(10000);

  if (mappings.error) return { data: null, error: mappings.error };

  const runs = new Map<
    string,
    { importRunId: string; rows: number; startedAt: string }
  >();
  for (const m of mappings.data ?? []) {
    const importRunId = (m.metadata as { importRunId?: string } | null)
      ?.importRunId;
    if (!importRunId) continue;
    const existing = runs.get(importRunId);
    if (existing) {
      existing.rows += 1;
    } else {
      runs.set(importRunId, { importRunId, rows: 1, startedAt: m.createdAt });
    }
  }

  return { data: [...runs.values()], error: null };
}
