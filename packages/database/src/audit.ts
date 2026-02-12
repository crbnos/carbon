import type { SupabaseClient } from "@supabase/supabase-js";
import { auditConfig } from "./audit.config";
import type {
  AuditLogArchive,
  AuditLogEntry,
  AuditLogFilters,
  AuditLogResponse,
  CreateAuditLogEntry
} from "./audit.types";
import {
  createEventSystemSubscription,
  deleteEventSystemSubscriptionsByName
} from "./event";

// Type for Supabase client with our custom RPC functions
type AuditRpcClient = {
  rpc(
    fn: "create_audit_log_table",
    params: { p_company_id: string }
  ): Promise<{ data: null; error: any }>;
  rpc(
    fn: "drop_audit_log_table",
    params: { p_company_id: string }
  ): Promise<{ data: null; error: any }>;
  rpc(
    fn: "insert_audit_log_batch",
    params: { p_company_id: string; p_entries: CreateAuditLogEntry[] }
  ): Promise<{ data: number | null; error: any }>;
  rpc(
    fn: "get_entity_audit_log",
    params: {
      p_company_id: string;
      p_entity_type: string;
      p_entity_id: string;
      p_limit?: number;
      p_offset?: number;
    }
  ): Promise<{ data: AuditLogEntry[] | null; error: any }>;
  rpc(
    fn: "get_audit_log",
    params: {
      p_company_id: string;
      p_entity_type?: string | null;
      p_actor_id?: string | null;
      p_operation?: string | null;
      p_start_date?: string | null;
      p_end_date?: string | null;
      p_search?: string | null;
      p_limit?: number;
      p_offset?: number;
    }
  ): Promise<{ data: AuditLogEntry[] | null; error: any }>;
  rpc(
    fn: "get_audit_log_count",
    params: {
      p_company_id: string;
      p_entity_type?: string | null;
      p_actor_id?: string | null;
      p_operation?: string | null;
      p_start_date?: string | null;
      p_end_date?: string | null;
      p_search?: string | null;
    }
  ): Promise<{ data: number | null; error: any }>;
  rpc(
    fn: "get_audit_logs_for_archive",
    params: { p_company_id: string; p_cutoff_date: string }
  ): Promise<{ data: AuditLogEntry[] | null; error: any }>;
  rpc(
    fn: "delete_old_audit_logs",
    params: { p_company_id: string; p_cutoff_date: string }
  ): Promise<{ data: number | null; error: any }>;
};

/**
 * Get audit log entries for a specific entity
 */
export async function getEntityAuditLog(
  client: SupabaseClient,
  companyId: string,
  entityType: string,
  entityId: string,
  options?: { limit?: number; offset?: number }
): Promise<AuditLogEntry[]> {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const { data, error } = await (client as unknown as AuditRpcClient).rpc(
    "get_entity_audit_log",
    {
      p_company_id: companyId,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_limit: limit,
      p_offset: offset
    }
  );

  if (error) {
    throw new Error(`Failed to fetch audit log: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Get audit log entries with filters (for global audit log view)
 */
export async function getGlobalAuditLog(
  client: SupabaseClient,
  companyId: string,
  filters?: AuditLogFilters
): Promise<AuditLogResponse> {
  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;

  // Get data
  const { data, error } = await (client as unknown as AuditRpcClient).rpc(
    "get_audit_log",
    {
      p_company_id: companyId,
      p_entity_type: filters?.entityType ?? null,
      p_actor_id: filters?.actorId ?? null,
      p_operation: filters?.operation ?? null,
      p_start_date: filters?.startDate ?? null,
      p_end_date: filters?.endDate ?? null,
      p_search: filters?.search ?? null,
      p_limit: limit,
      p_offset: offset
    }
  );

  if (error) {
    throw new Error(`Failed to fetch audit log: ${error.message}`);
  }

  // Get count
  const { data: count, error: countError } = await (
    client as unknown as AuditRpcClient
  ).rpc("get_audit_log_count", {
    p_company_id: companyId,
    p_entity_type: filters?.entityType ?? null,
    p_actor_id: filters?.actorId ?? null,
    p_operation: filters?.operation ?? null,
    p_start_date: filters?.startDate ?? null,
    p_end_date: filters?.endDate ?? null,
    p_search: filters?.search ?? null
  });

  if (countError) {
    throw new Error(`Failed to fetch audit log count: ${countError.message}`);
  }

  return {
    data: data ?? [],
    count: count ?? 0
  };
}

/**
 * Insert audit log entries (used by the audit handler task)
 */
export async function insertAuditLogEntries(
  client: SupabaseClient,
  companyId: string,
  entries: CreateAuditLogEntry[]
): Promise<number> {
  if (entries.length === 0) return 0;

  const { data, error } = await (client as unknown as AuditRpcClient).rpc(
    "insert_audit_log_batch",
    {
      p_company_id: companyId,
      p_entries: entries
    }
  );

  if (error) {
    throw new Error(`Failed to insert audit log entries: ${error.message}`);
  }

  return data ?? 0;
}

/**
 * Enable audit logging for a company
 * Creates the per-company audit log table and event subscriptions
 */
export async function enableAuditLog(
  client: SupabaseClient,
  companyId: string
): Promise<void> {
  // Create the per-company audit log table
  const { error: createError } = await (
    client as unknown as AuditRpcClient
  ).rpc("create_audit_log_table", {
    p_company_id: companyId
  });

  if (createError) {
    throw new Error(`Failed to create audit log table: ${createError.message}`);
  }

  // Update company flag
  const { error: updateError } = await client
    .from("company")
    .update({ auditLogEnabled: true })
    .eq("id", companyId);

  if (updateError) {
    throw new Error(`Failed to enable audit log: ${updateError.message}`);
  }

  // Create AUDIT subscriptions for all auditable entities
  for (const entity of auditConfig.entities) {
    await createEventSystemSubscription(client, {
      name: `audit-${entity}`,
      table: entity,
      companyId,
      operations: ["INSERT", "UPDATE", "DELETE"],
      type: "AUDIT",
      config: {},
      filter: {},
      active: true
    });
  }
}

/**
 * Disable audit logging for a company
 * Removes event subscriptions but keeps existing audit logs
 */
export async function disableAuditLog(
  client: SupabaseClient,
  companyId: string
): Promise<void> {
  // Update company flag
  const { error: updateError } = await client
    .from("company")
    .update({ auditLogEnabled: false })
    .eq("id", companyId);

  if (updateError) {
    throw new Error(`Failed to disable audit log: ${updateError.message}`);
  }

  // Delete AUDIT subscriptions for all auditable entities
  for (const entity of auditConfig.entities) {
    await deleteEventSystemSubscriptionsByName(
      client,
      companyId,
      `audit-${entity}`
    );
  }

  // Note: We don't drop the table - keep the data for compliance
}

/**
 * Check if audit logging is enabled for a company
 */
export async function isAuditLogEnabled(
  client: SupabaseClient,
  companyId: string
): Promise<boolean> {
  const { data, error } = await client
    .from("company")
    .select("auditLogEnabled")
    .eq("id", companyId)
    .single();

  if (error) {
    throw new Error(`Failed to check audit log status: ${error.message}`);
  }

  return (
    (data as { auditLogEnabled: boolean } | null)?.auditLogEnabled ?? false
  );
}

/**
 * Get list of archived audit log periods for a company
 */
export async function getAuditLogArchives(
  client: SupabaseClient,
  companyId: string
): Promise<AuditLogArchive[]> {
  const { data, error } = await client
    .from("auditLogArchive")
    .select("*")
    .eq("companyId", companyId)
    .order("endDate", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch audit log archives: ${error.message}`);
  }

  return data as AuditLogArchive[];
}

/**
 * Get a signed URL for downloading an archived audit log
 */
export async function getArchiveDownloadUrl(
  client: SupabaseClient,
  archiveId: string
): Promise<string> {
  // First get the archive record to get the path
  const { data: archive, error: fetchError } = await client
    .from("auditLogArchive")
    .select("archivePath")
    .eq("id", archiveId)
    .single();

  if (fetchError || !archive) {
    throw new Error(`Archive not found: ${fetchError?.message}`);
  }

  // Generate signed URL (1 hour expiry)
  const { data, error } = await client.storage
    .from(auditConfig.archiveBucket)
    .createSignedUrl((archive as { archivePath: string }).archivePath, 3600);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to generate download URL: ${error?.message}`);
  }

  return data.signedUrl;
}

/**
 * Get audit logs for archival
 */
export async function getAuditLogsForArchive(
  client: SupabaseClient,
  companyId: string,
  cutoffDate: Date
): Promise<AuditLogEntry[]> {
  const { data, error } = await (client as unknown as AuditRpcClient).rpc(
    "get_audit_logs_for_archive",
    {
      p_company_id: companyId,
      p_cutoff_date: cutoffDate.toISOString()
    }
  );

  if (error) {
    throw new Error(`Failed to get audit logs for archive: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Delete audit log entries older than a certain date
 * Used by the archive task after successful export
 */
export async function deleteOldAuditLogs(
  client: SupabaseClient,
  companyId: string,
  cutoffDate: Date
): Promise<number> {
  const { data, error } = await (client as unknown as AuditRpcClient).rpc(
    "delete_old_audit_logs",
    {
      p_company_id: companyId,
      p_cutoff_date: cutoffDate.toISOString()
    }
  );

  if (error) {
    throw new Error(`Failed to delete old audit logs: ${error.message}`);
  }

  return data ?? 0;
}

/**
 * Record an archive in the tracking table
 */
export async function recordAuditLogArchive(
  client: SupabaseClient,
  archive: Omit<AuditLogArchive, "id" | "createdAt">
): Promise<void> {
  const { error } = await client.from("auditLogArchive").insert(archive);

  if (error) {
    throw new Error(`Failed to record audit log archive: ${error.message}`);
  }
}
