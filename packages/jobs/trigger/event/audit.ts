import { getCarbonServiceRole } from "@carbon/auth";
import {
  auditConfig,
  getEntityConfigsForTable,
  isAuditableTable,
  isChildTable,
  isExtensionTable,
  isIndirectTable,
  isRootTable,
} from "@carbon/database/audit.config";
import type { AuditEntityType } from "@carbon/database/audit.config";
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
  actorId: z.string().nullish(),
  handlerConfig: z.record(z.any()),
});

const AuditPayloadSchema = z.object({
  records: z.array(AuditRecordSchema),
});

export type AuditPayload = z.infer<typeof AuditPayloadSchema>;

/**
 * Compute the diff between old and new record values.
 * Supports deep diffing for JSONB fields.
 */
function computeDiff(
  old: Record<string, unknown>,
  newRecord: Record<string, unknown>
): AuditDiff | null {
  const diff: AuditDiff = {};
  const skipFields = auditConfig.skipFields;

  const allKeys = new Set([...Object.keys(old), ...Object.keys(newRecord)]);

  for (const key of allKeys) {
    if ((skipFields as readonly string[]).includes(key)) continue;

    const oldValue = old[key];
    const newValue = newRecord[key];

    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
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
 * Compute nested diff for object fields (like customFields).
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
        logger.info(`Skipping ${records.length} records: missing companyId`);
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
        logger.info(
          `Skipping ${records.length} records: audit logging disabled for company ${companyId}`
        );
        results.skipped += records.length;
        continue;
      }

      // Process records and build entries
      const entries: CreateAuditLogEntry[] = [];

      for (const record of records) {
        const tableName = record.event.table;

        // Skip non-auditable tables
        if (!isAuditableTable(tableName)) {
          logger.info(`Skipping: table "${tableName}" is not auditable`);
          results.skipped++;
          continue;
        }

        // Skip TRUNCATE operations
        if (record.event.operation === "TRUNCATE") {
          logger.info(`Skipping: TRUNCATE on "${tableName}" is not meaningful`);
          results.skipped++;
          continue;
        }

        try {
          // Resolve actorId: event payload first, fallback to record data
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

            if (!diff) {
              logger.info(
                `Skipping: no meaningful diff for UPDATE on "${tableName}" record ${record.event.recordId}`
              );
              results.skipped++;
              continue;
            }
          }

          const operation = record.event
            .operation as CreateAuditLogEntry["operation"];
          const entryActorId = (actorId as string) ?? null;
          const entryMetadata = record.handlerConfig.metadata ?? null;

          // Get all entity configs that track this table
          const entityConfigs = getEntityConfigsForTable(tableName);

          if (entityConfigs.length === 0) {
            logger.info(
              `Skipping: no entity config found for table "${tableName}"`
            );
            results.skipped++;
            continue;
          }

          let entriesCreatedForRecord = 0;

          for (const entityEntry of entityConfigs) {
            const { entityType, tableConfig } = entityEntry;

            // Skip INSERT events for non-root tables — these are just
            // default rows created alongside the parent entity (extensions)
            // or child rows that will get meaningful UPDATEs later.
            if (
              record.event.operation === "INSERT" &&
              !isRootTable(tableConfig)
            ) {
              logger.info(
                `Skipping: INSERT on non-root table "${tableName}" for entity "${entityType}"`
              );
              continue;
            }

            if (isRootTable(tableConfig)) {
              // Root table: recordId IS the entity ID
              entries.push({
                tableName,
                entityType,
                entityId: record.event.recordId,
                operation,
                actorId: entryActorId,
                diff,
                metadata: entryMetadata,
              });
              entriesCreatedForRecord++;
            } else if (isExtensionTable(tableConfig)) {
              // Extension table: PK = parent FK, so recordId IS the entity ID
              // (same resolution as root, but INSERT is already skipped above)
              entries.push({
                tableName,
                entityType,
                entityId: record.event.recordId,
                operation,
                actorId: entryActorId,
                diff,
                metadata: entryMetadata,
              });
              entriesCreatedForRecord++;
            } else if (isChildTable(tableConfig)) {
              // Child table: extract entity ID from the named column
              const recordData = record.event.new ?? record.event.old;
              const entityId = recordData?.[tableConfig.entityIdColumn];

              if (!entityId) {
                logger.info(
                  `Skipping: could not resolve entity ID from column "${tableConfig.entityIdColumn}" for "${tableName}" record ${record.event.recordId}`
                );
                continue;
              }

              entries.push({
                tableName,
                entityType,
                entityId: String(entityId),
                operation,
                actorId: entryActorId,
                diff,
                metadata: entryMetadata,
              });
              entriesCreatedForRecord++;
            } else if (isIndirectTable(tableConfig)) {
              // Indirect table: resolve via junction table query
              const { junction, fk, entityIdColumn } = tableConfig.resolve;

              const { data: junctionRow } = await client
                .from(junction as any)
                .select(entityIdColumn)
                .eq(fk, record.event.recordId)
                .limit(1)
                .maybeSingle();

              const row = junctionRow as unknown as Record<
                string,
                unknown
              > | null;
              if (row && row[entityIdColumn]) {
                entries.push({
                  tableName,
                  entityType,
                  entityId: String(row[entityIdColumn]),
                  operation,
                  actorId: entryActorId,
                  diff,
                  metadata: entryMetadata,
                });
                entriesCreatedForRecord++;
              } else {
                logger.info(
                  `Skipping: no parent entity found via junction "${junction}" for "${tableName}" record ${record.event.recordId} (entity: ${entityType})`
                );
              }
            }
          }

          if (entriesCreatedForRecord === 0) {
            logger.info(
              `Skipping: could not resolve any entity for "${tableName}" record ${record.event.recordId}`
            );
            results.skipped++;
          }
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
