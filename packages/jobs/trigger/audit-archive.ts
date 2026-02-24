import { getCarbonServiceRole } from "@carbon/auth";
import { auditConfig } from "@carbon/database/audit.config";
import type { AuditLogEntry } from "@carbon/database/audit.types";
import { logger, schedules } from "@trigger.dev/sdk/v3";
import { gzipSync } from "node:zlib";

// Type for RPC calls
type AuditArchiveRpcClient = {
  rpc(
    fn: "get_audit_logs_for_archive",
    params: { p_company_id: string; p_before_date: string }
  ): Promise<{ data: AuditLogEntry[] | null; error: any }>;
  rpc(
    fn: "delete_old_audit_logs",
    params: { p_company_id: string; p_cutoff_date: string }
  ): Promise<{ data: number | null; error: any }>;
};

/**
 * Scheduled task to archive old audit logs
 * Runs daily at 2 AM UTC
 * Exports audit logs older than retentionDays to gzipped JSONL files
 * Stores them in the private storage bucket and records in auditLogArchive table
 */
export const auditLogArchiveTask = schedules.task({
  id: "audit-log-archive",
  cron: "0 2 * * *", // Daily at 2 AM UTC
  retry: {
    maxAttempts: 3,
    factor: 2,
    randomize: true,
  },
  run: async () => {
    const client = getCarbonServiceRole();

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - auditConfig.retentionDays);

    logger.info(`Archiving audit logs older than ${cutoffDate.toISOString()}`);

    // Get companies with audit logs enabled
    const { data: companies, error: companiesError } = await client
      .from("company")
      .select("id")
      .eq("auditLogEnabled", true);

    if (companiesError) {
      logger.error("Failed to fetch companies", { error: companiesError });
      throw new Error(`Failed to fetch companies: ${companiesError.message}`);
    }

    const results = {
      companiesProcessed: 0,
      recordsArchived: 0,
      recordsDeleted: 0,
      errors: 0,
    };

    for (const company of (companies as { id: string }[]) ?? []) {
      try {
        const archived = await archiveCompanyLogs(
          client as unknown as AuditArchiveRpcClient &
            ReturnType<typeof getCarbonServiceRole>,
          company.id,
          cutoffDate
        );
        results.companiesProcessed++;
        results.recordsArchived += archived.recordsArchived;
        results.recordsDeleted += archived.recordsDeleted;
      } catch (error) {
        logger.error(`Failed to archive logs for company ${company.id}`, {
          error,
        });
        results.errors++;
      }
    }

    logger.info("Audit log archive task completed", results);
    return results;
  },
});

async function archiveCompanyLogs(
  client: AuditArchiveRpcClient & ReturnType<typeof getCarbonServiceRole>,
  companyId: string,
  cutoffDate: Date
): Promise<{ recordsArchived: number; recordsDeleted: number }> {
  // Fetch old records using RPC
  const { data: records, error: fetchError } = await client.rpc(
    "get_audit_logs_for_archive",
    {
      p_company_id: companyId,
      p_before_date: cutoffDate.toISOString(),
    }
  );

  if (fetchError) {
    throw new Error(`Failed to fetch audit logs: ${fetchError.message}`);
  }

  if (!records || records.length === 0) {
    return { recordsArchived: 0, recordsDeleted: 0 };
  }

  logger.info(`Archiving ${records.length} records for company ${companyId}`);

  // Convert to JSONL format
  const jsonl = records.map((r) => JSON.stringify(r)).join("\n");
  const gzipped = gzipSync(Buffer.from(jsonl));

  // Generate archive path
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const timestamp = `${year}-${month}-${day}`;
  const archivePath = `audit-logs/${companyId}/${year}/${month}/${timestamp}.jsonl.gz`;

  // Upload to storage
  const { error: uploadError } = await client.storage
    .from(auditConfig.archiveBucket)
    .upload(archivePath, gzipped, {
      contentType: "application/gzip",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Failed to upload archive: ${uploadError.message}`);
  }

  // Get date range from records
  const startDate = records[0].createdAt;
  const endDate = records[records.length - 1].createdAt;

  // Record archive metadata
  const { error: archiveError } = await client.from("auditLogArchive").insert({
    companyId,
    archivePath,
    startDate: startDate.split("T")[0], // Extract date part
    endDate: endDate.split("T")[0],
    rowCount: records.length,
    sizeBytes: gzipped.length,
  });

  if (archiveError) {
    // Try to clean up uploaded file
    await client.storage.from(auditConfig.archiveBucket).remove([archivePath]);
    throw new Error(`Failed to record archive: ${archiveError.message}`);
  }

  // Delete archived records using RPC
  const { data: deletedCount, error: deleteError } = await client.rpc(
    "delete_old_audit_logs",
    {
      p_company_id: companyId,
      p_cutoff_date: cutoffDate.toISOString(),
    }
  );

  if (deleteError) {
    logger.error(`Failed to delete archived records for ${companyId}`, {
      error: deleteError,
    });
    // Don't throw - archive was successful, just couldn't clean up
    return { recordsArchived: records.length, recordsDeleted: 0 };
  }

  return {
    recordsArchived: records.length,
    recordsDeleted: deletedCount ?? records.length,
  };
}
