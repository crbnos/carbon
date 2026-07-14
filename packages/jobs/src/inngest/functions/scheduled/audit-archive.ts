import { gzipSync } from "node:zlib";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { auditConfig } from "@carbon/database/audit.config";
import type { AuditLogEntry } from "@carbon/database/audit.types";
import { getLogger } from "@carbon/logger";
import { inngest } from "../../client";

const log = getLogger("jobs", "audit-archive");

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
      p_before_date: cutoffDate.toISOString()
    }
  );

  if (fetchError) {
    throw new Error(`Failed to fetch audit logs: ${fetchError.message}`);
  }

  if (!records || records.length === 0) {
    return { recordsArchived: 0, recordsDeleted: 0 };
  }

  log.info(`Archiving ${records.length} records for company ${companyId}`);

  // Convert to JSONL format
  const jsonl = records.map((r) => JSON.stringify(r)).join("\n");
  const gzipped = gzipSync(Buffer.from(jsonl));

  // Generate archive path
  const nowDate = new Date();
  const year = nowDate.getFullYear();
  const month = String(nowDate.getMonth() + 1).padStart(2, "0");
  const day = String(nowDate.getDate()).padStart(2, "0");
  const timestamp = `${year}-${month}-${day}`;
  const archivePath = `audit-logs/${companyId}/${year}/${month}/${timestamp}.jsonl.gz`;

  // Upload to storage
  const { error: uploadError } = await client.storage
    .from(auditConfig.archiveBucket)
    .upload(archivePath, gzipped, {
      contentType: "application/gzip",
      upsert: true
    });

  if (uploadError) {
    throw new Error(`Failed to upload archive: ${uploadError.message}`);
  }

  // Get date range from records
  const startDate = records[0]!.createdAt;
  const endDate = records[records.length - 1]!.createdAt;

  // Record archive metadata
  const { error: archiveError } = await client.from("auditLogArchive").insert({
    companyId,
    archivePath,
    startDate: startDate.split("T")[0]!, // Extract date part
    endDate: endDate.split("T")[0]!,
    rowCount: records.length,
    sizeBytes: gzipped.length
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
      p_cutoff_date: cutoffDate.toISOString()
    }
  );

  if (deleteError) {
    log.error(`Failed to delete archived records for ${companyId}`, {
      error: deleteError
    });
    // Don't throw - archive was successful, just couldn't clean up
    return { recordsArchived: records.length, recordsDeleted: 0 };
  }

  return {
    recordsArchived: records.length,
    recordsDeleted: deletedCount ?? records.length
  };
}

export const auditArchiveFunction = inngest.createFunction(
  { id: "audit-log-archive", retries: 2 },
  { cron: "0 2 * * *" },
  async ({ step, logger }) => {
    const results = await step.run("archive-audit-logs", async () => {
      const client = getCarbonServiceRole();

      // Calculate cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - auditConfig.retentionDays);

      logger.info(
        `Archiving audit logs older than ${cutoffDate.toISOString()}`
      );

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
        errors: 0
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
            error
          });
          results.errors++;
        }
      }

      logger.info("Audit log archive task completed", results);
      return results;
    });

    return results;
  }
);
