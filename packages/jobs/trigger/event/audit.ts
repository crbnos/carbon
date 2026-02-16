import { getCarbonServiceRole } from "@carbon/auth";
import {
  auditConfig,
  getEntityTypeForTable,
  isAuditableTable,
} from "@carbon/database/audit.config";
import type {
  AuditDiff,
  CreateAuditLogEntry,
} from "@carbon/database/audit.types";
import { groupBy } from "@carbon/utils";
import { logger, task } from "@trigger.dev/sdk/v3";
import { z } from "zod";

const AuditRecordSchema = z.object({
  event: z.object({
    table: z.string(),
    operation: z.enum(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]),
    recordId: z.string(),
    new: z.record(z.any()).nullable(),
    old: z.record(z.any()).nullable(),
    timestamp: z.string(),
  }),
  companyId: z.string(),
  actorId: z.string().nullish(), // Captured from auth.uid() at event time (can be null/undefined for service role)
  handlerConfig: z.record(z.any()),
});

const AuditPayloadSchema = z.object({
  records: z.array(AuditRecordSchema),
});

export type AuditPayload = z.infer<typeof AuditPayloadSchema>;

/**
 * Compute the diff between old and new record values
 * Supports deep diffing for JSONB fields
 */
function computeDiff(
  old: Record<string, unknown>,
  newRecord: Record<string, unknown>
): AuditDiff | null {
  const diff: AuditDiff = {};
  const skipFields = auditConfig.skipFields;

  const allKeys = new Set([...Object.keys(old), ...Object.keys(newRecord)]);

  for (const key of allKeys) {
    // Skip fields that always change
    if ((skipFields as readonly string[]).includes(key)) continue;

    const oldValue = old[key];
    const newValue = newRecord[key];

    // Check if values are different
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      // Deep diff for objects (like customFields)
      if (
        typeof oldValue === "object" &&
        oldValue !== null &&
        typeof newValue === "object" &&
        newValue !== null &&
        !Array.isArray(oldValue) &&
        !Array.isArray(newValue)
      ) {
        const nestedDiff = computeNestedDiff(
          oldValue as Record<string, unknown>,
          newValue as Record<string, unknown>,
          key
        );
        Object.assign(diff, nestedDiff);
      } else {
        diff[key] = { old: oldValue, new: newValue };
      }
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
}

/**
 * Compute nested diff for object fields (like customFields)
 */
function computeNestedDiff(
  old: Record<string, unknown>,
  newRecord: Record<string, unknown>,
  prefix: string
): AuditDiff {
  const diff: AuditDiff = {};

  const allKeys = new Set([...Object.keys(old), ...Object.keys(newRecord)]);

  for (const key of allKeys) {
    const oldValue = old[key];
    const newValue = newRecord[key];

    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      diff[`${prefix}.${key}`] = { old: oldValue, new: newValue };
    }
  }

  return diff;
}

// Type for RPC call
type AuditRpcClient = {
  rpc(
    fn: "insert_audit_log_batch",
    params: { p_company_id: string; p_entries: object[] }
  ): Promise<{ data: number | null; error: any }>;
};

export const auditTask = task({
  id: "event-handler-audit",
  retry: {
    maxAttempts: 3,
    factor: 2,
    randomize: true,
  },
  run: async (input: unknown) => {
    const payload = AuditPayloadSchema.parse(input);

    logger.info(`Processing ${payload.records.length} audit log events`);

    const results = {
      inserted: 0,
      skipped: 0,
      failed: 0,
    };

    const client = getCarbonServiceRole();

    // Group by companyId for efficient processing
    type AuditRecord = (typeof payload.records)[number];
    const byCompany = groupBy(payload.records, (r) => r.companyId);

    for (const [companyId, records] of Object.entries(byCompany) as [
      string,
      AuditRecord[]
    ][]) {
      if (!companyId || companyId === "undefined") {
        results.skipped += records.length;
        continue;
      }

      // Check if company has audit logs enabled
      const { data: company } = await client
        .from("company")
        .select("auditLogEnabled")
        .eq("id", companyId)
        .single();

      if (!(company as { auditLogEnabled: boolean } | null)?.auditLogEnabled) {
        results.skipped += records.length;
        continue;
      }

      // Process records and build entries
      const entries: CreateAuditLogEntry[] = [];

      for (const record of records) {
        // Skip non-auditable tables
        if (!isAuditableTable(record.event.table)) {
          results.skipped++;
          continue;
        }

        // Skip TRUNCATE operations (not meaningful for audit)
        if (record.event.operation === "TRUNCATE") {
          results.skipped++;
          continue;
        }

        try {
          // Use actorId from the event payload (captured from auth.uid() at trigger time)
          // Falls back to updatedBy/createdBy if actorId is not available (e.g., service role operations)
          const actorId =
            record.actorId ??
            record.event.new?.updatedBy ??
            record.event.new?.createdBy ??
            record.event.old?.updatedBy ??
            record.event.old?.createdBy;

          // Compute diff for UPDATE operations
          let diff: AuditDiff | null = null;
          if (
            record.event.operation === "UPDATE" &&
            record.event.old &&
            record.event.new
          ) {
            diff = computeDiff(
              record.event.old as Record<string, unknown>,
              record.event.new as Record<string, unknown>
            );

            // Skip if no meaningful changes
            if (!diff) {
              results.skipped++;
              continue;
            }
          }

          const tableName = record.event
            .table as CreateAuditLogEntry["tableName"];

          entries.push({
            tableName,
            entityType: getEntityTypeForTable(tableName),
            entityId: record.event.recordId,
            operation: record.event
              .operation as CreateAuditLogEntry["operation"],
            actorId: (actorId as string) ?? null,
            diff,
            metadata: record.handlerConfig.metadata ?? null,
          });
        } catch (error) {
          logger.error(`Failed to process audit record:`, {
            error,
            record,
          });
          results.failed++;
        }
      }

      // Batch insert entries using RPC
      if (entries.length > 0) {
        const { data: insertedCount, error } = await (
          client as unknown as AuditRpcClient
        ).rpc("insert_audit_log_batch", {
          p_company_id: companyId,
          p_entries: entries,
        });

        if (error) {
          logger.error(`Failed to insert audit log entries:`, { error });
          results.failed += entries.length;
        } else {
          results.inserted += insertedCount ?? entries.length;
        }
      }
    }

    logger.info("Audit task completed", results);

    return results;
  },
});
