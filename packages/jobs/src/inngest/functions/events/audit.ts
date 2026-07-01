import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { TableConfig } from "@carbon/database/audit.config";
import {
  auditConfig,
  getCreateFields,
  getEntityConfigsForTable,
  getSnapshotFields,
  isAuditableTable,
  isChildTable,
  isExtensionTable,
  isIndirectTable,
  isRootTable
} from "@carbon/database/audit.config";
import type {
  AuditDiff,
  CreateAuditLogEntry
} from "@carbon/database/audit.types";
import { groupBy } from "@carbon/utils";
import { z } from "zod";
import { inngest } from "../../client";

const AuditRecordSchema = z.object({
  event: z.object({
    table: z.string(),
    operation: z.enum(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]),
    recordId: z.string(),
    new: z.record(z.any()).nullable(),
    old: z.record(z.any()).nullable(),
    timestamp: z.string()
  }),
  companyId: z.string(),
  actorId: z.string().nullish(),
  handlerConfig: z.record(z.any())
});

const AuditPayloadSchema = z.object({
  records: z.array(AuditRecordSchema)
});

export type AuditPayload = z.infer<typeof AuditPayloadSchema>;

/**
 * Whether a diff key should be excluded from the audit log. Matches both
 * top-level columns (`"embedding"`) and any nested suffix (`"foo.embedding"`)
 * so vector / metadata columns don't leak when they appear inside JSON
 * containers or under createField allowlists.
 */
function isSkippedAuditKey(key: string): boolean {
  const skip = auditConfig.skipFields as readonly string[];
  for (let i = 0; i < skip.length; i++) {
    const s = skip[i]!;
    if (key === s || key.endsWith(`.${s}`)) return true;
  }
  return false;
}

/**
 * Compute the diff between old and new record values.
 */
function computeDiff(
  old: Record<string, unknown>,
  newRecord: Record<string, unknown>
): AuditDiff | null {
  const diff: AuditDiff = {};

  const allKeys = new Set([...Object.keys(old), ...Object.keys(newRecord)]);

  for (const key of allKeys) {
    if (isSkippedAuditKey(key)) continue;

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
 * Build a diff for INSERT events from an allowlist of columns.
 * Returns null when no fields are configured or none are present on the record.
 * Globally-skipped fields (e.g. `embedding`) are dropped even if listed in
 * `createFields` so vector / metadata noise can't leak into CREATE diffs.
 */
function computeCreateDiff(
  newRecord: Record<string, unknown>,
  createFields: readonly string[]
): AuditDiff | null {
  if (createFields.length === 0) return null;

  const diff: AuditDiff = {};
  for (const field of createFields) {
    if (isSkippedAuditKey(field)) continue;
    if (field in newRecord) {
      diff[field] = { new: newRecord[field] };
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
}

function computeNestedDiff(
  old: Record<string, unknown>,
  newRecord: Record<string, unknown>,
  prefix: string
): AuditDiff {
  const diff: AuditDiff = {};

  const allKeys = new Set([...Object.keys(old), ...Object.keys(newRecord)]);

  for (const key of allKeys) {
    const fullKey = `${prefix}.${key}`;
    if (isSkippedAuditKey(fullKey)) continue;

    const oldValue = old[key];
    const newValue = newRecord[key];

    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      diff[fullKey] = { old: oldValue, new: newValue };
    }
  }

  return diff;
}

type AuditRpcClient = {
  rpc(
    fn: "insert_audit_log_batch",
    params: { p_company_id: string; p_entries: object[] }
  ): Promise<{ data: number | null; error: any }>;
};

export const auditFunction = inngest.createFunction(
  {
    id: "event-handler-audit",
    retries: 3
  },
  { event: "carbon/event-audit" },
  async ({ event, step }) => {
    const payload = AuditPayloadSchema.parse(event.data);

    console.log(`Processing ${payload.records.length} audit log events`);

    const results = {
      inserted: 0,
      skipped: 0,
      failed: 0
    };

    const client = getCarbonServiceRole();

    type AuditRecord = (typeof payload.records)[number];
    const byCompany = groupBy(payload.records, (r) => r.companyId);

    for (const [companyId, records] of Object.entries(byCompany) as [
      string,
      AuditRecord[]
    ][]) {
      if (!companyId || companyId === "undefined") {
        console.log(`Skipping ${records.length} records: missing companyId`);
        results.skipped += records.length;
        continue;
      }

      const companyResult = await step.run(`audit-${companyId}`, async () => {
        const stepResults = { inserted: 0, skipped: 0, failed: 0 };

        // Check if company has audit logs enabled
        const { data: company } = await client
          .from("company")
          .select("auditLogEnabled")
          .eq("id", companyId)
          .single();

        if (
          !(company as { auditLogEnabled: boolean } | null)?.auditLogEnabled
        ) {
          console.log(
            `Skipping ${records.length} records: audit logging disabled for company ${companyId}`
          );
          stepResults.skipped += records.length;
          return stepResults;
        }

        const entries: CreateAuditLogEntry[] = [];

        for (const record of records) {
          const tableName = record.event.table;

          if (!isAuditableTable(tableName)) {
            console.log(`Skipping: table "${tableName}" is not auditable`);
            stepResults.skipped++;
            continue;
          }

          if (record.event.operation === "TRUNCATE") {
            console.log(
              `Skipping: TRUNCATE on "${tableName}" is not meaningful`
            );
            stepResults.skipped++;
            continue;
          }

          try {
            const actorId =
              record.actorId ??
              record.event.new?.updatedBy ??
              record.event.new?.createdBy ??
              record.event.old?.updatedBy ??
              record.event.old?.createdBy;

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
                console.log(
                  `Skipping: no meaningful diff for UPDATE on "${tableName}" record ${record.event.recordId}`
                );
                stepResults.skipped++;
                continue;
              }
            }

            const operation = record.event
              .operation as CreateAuditLogEntry["operation"];
            const entryActorId = (actorId as string) ?? null;
            const entryMetadata = record.handlerConfig.metadata ?? null;

            const entityConfigs = getEntityConfigsForTable(tableName);

            if (entityConfigs.length === 0) {
              console.log(
                `Skipping: no entity config found for table "${tableName}"`
              );
              stepResults.skipped++;
              continue;
            }

            let entriesCreatedForRecord = 0;

            for (const entityEntry of entityConfigs) {
              const { entityType, tableConfig } = entityEntry;

              if (
                record.event.operation === "INSERT" &&
                !isRootTable(tableConfig)
              ) {
                console.log(
                  `Skipping: INSERT on non-root table "${tableName}" for entity "${entityType}"`
                );
                continue;
              }

              const effectiveDiff =
                record.event.operation === "INSERT" && record.event.new
                  ? computeCreateDiff(
                      record.event.new as Record<string, unknown>,
                      getCreateFields(tableConfig)
                    )
                  : diff;

              if (isRootTable(tableConfig)) {
                entries.push({
                  tableName,
                  entityType,
                  entityId: record.event.recordId,
                  recordId: record.event.recordId,
                  operation,
                  actorId: entryActorId,
                  diff: effectiveDiff,
                  metadata: entryMetadata,
                  createdAt: record.event.timestamp
                });
                entriesCreatedForRecord++;
              } else if (isExtensionTable(tableConfig)) {
                entries.push({
                  tableName,
                  entityType,
                  entityId: record.event.recordId,
                  recordId: record.event.recordId,
                  operation,
                  actorId: entryActorId,
                  diff: effectiveDiff,
                  metadata: entryMetadata,
                  createdAt: record.event.timestamp
                });
                entriesCreatedForRecord++;
              } else if (isChildTable(tableConfig)) {
                const recordData = record.event.new ?? record.event.old;
                const entityId = recordData?.[tableConfig.entityIdColumn];

                if (!entityId) {
                  console.log(
                    `Skipping: could not resolve entity ID from column "${tableConfig.entityIdColumn}" for "${tableName}" record ${record.event.recordId}`
                  );
                  continue;
                }

                entries.push({
                  tableName,
                  entityType,
                  entityId: String(entityId),
                  recordId: record.event.recordId,
                  operation,
                  actorId: entryActorId,
                  diff: effectiveDiff,
                  metadata: entryMetadata,
                  createdAt: record.event.timestamp
                });
                entriesCreatedForRecord++;
              } else if (isIndirectTable(tableConfig)) {
                const { junction, fk, entityIdColumn } = tableConfig.resolve;

                const { data: junctionRow } = await (client as any)
                  .from(junction)
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
                    recordId: record.event.recordId,
                    operation,
                    actorId: entryActorId,
                    diff: effectiveDiff,
                    metadata: entryMetadata
                  });
                  entriesCreatedForRecord++;
                } else {
                  console.log(
                    `Skipping: no parent entity found via junction "${junction}" for "${tableName}" record ${record.event.recordId} (entity: ${entityType})`
                  );
                }
              }
            }

            if (entriesCreatedForRecord === 0) {
              console.log(
                `Skipping: could not resolve any entity for "${tableName}" record ${record.event.recordId}`
              );
              stepResults.skipped++;
            }
          } catch (error) {
            console.error(`Failed to process audit record:`, {
              error,
              record
            });
            stepResults.failed++;
          }
        }

        // Snapshot FK target display values into each diff before insert.
        // Frozen at write time — renames/deletes of the FK target do not
        // rewrite history.
        await applyFkSnapshots(client, companyId, entries);

        // Batch insert entries using RPC
        if (entries.length > 0) {
          const { data: insertedCount, error } = await (
            client as unknown as AuditRpcClient
          ).rpc("insert_audit_log_batch", {
            p_company_id: companyId,
            p_entries: entries
          });

          if (error) {
            console.error(`Failed to insert audit log entries:`, { error });
            stepResults.failed += entries.length;
          } else {
            stepResults.inserted += insertedCount ?? entries.length;
          }
        }

        return stepResults;
      });

      results.inserted += companyResult.inserted;
      results.skipped += companyResult.skipped;
      results.failed += companyResult.failed;
    }

    console.log("Audit function completed", results);

    return results;
  }
);

/**
 * For every entry whose tableConfig declares `snapshotFields`, look up the
 * FK target's display columns and freeze them onto the diff entry under
 * `snapshot.old` / `snapshot.new`. One batched query per target table —
 * proportional to distinct FK targets, not to entries.
 */
async function applyFkSnapshots(
  client: ReturnType<typeof getCarbonServiceRole>,
  companyId: string,
  entries: CreateAuditLogEntry[]
): Promise<void> {
  type Ref = {
    diffEntry: {
      old?: unknown;
      new?: unknown;
      snapshot?: {
        old?: Record<string, unknown>;
        new?: Record<string, unknown>;
      };
    };
    table: string;
    displayColumns: readonly string[];
  };

  const refs: Ref[] = [];
  const idsByTable = new Map<string, Set<string>>();
  const colsByTable = new Map<string, Set<string>>();

  for (const entry of entries) {
    if (!entry.diff) continue;
    const configs = getEntityConfigsForTable(entry.tableName).filter(
      (c) => c.entityType === entry.entityType
    );
    for (const { tableConfig } of configs) {
      const snapshots = getSnapshotFields(tableConfig as TableConfig);
      for (const snap of snapshots) {
        const change = entry.diff[snap.column];
        if (!change) continue;
        refs.push({
          diffEntry: change,
          table: snap.table,
          displayColumns: snap.displayColumns
        });

        const ids = idsByTable.get(snap.table) ?? new Set<string>();
        if (typeof change.old === "string") ids.add(change.old);
        if (typeof change.new === "string") ids.add(change.new);
        idsByTable.set(snap.table, ids);

        const cols = colsByTable.get(snap.table) ?? new Set<string>();
        for (const c of snap.displayColumns) cols.add(c);
        colsByTable.set(snap.table, cols);
      }
    }
  }

  if (refs.length === 0) return;

  // (table, id) → { col: value, ... } — full snapshot row per id
  const lookup = new Map<string, Record<string, unknown>>();

  for (const [table, ids] of idsByTable) {
    if (ids.size === 0) continue;
    const cols = colsByTable.get(table);
    if (!cols || cols.size === 0) continue;
    const selectClause = ["id", ...cols].join(", ");

    try {
      const { data, error } = await (client as any)
        .from(table)
        .select(selectClause)
        .eq("companyId", companyId)
        .in("id", Array.from(ids));

      if (error || !data) continue;

      for (const row of data as Array<Record<string, unknown>>) {
        const rowId = row?.id;
        if (typeof rowId !== "string") continue;
        const snapshot: Record<string, unknown> = {};
        for (const col of cols) snapshot[col] = row[col];
        lookup.set(`${table}::${rowId}`, snapshot);
      }
    } catch (err) {
      console.error(`FK snapshot lookup failed for table "${table}":`, err);
    }
  }

  // Pick only the columns this ref asked for. Multiple refs can share a
  // target table but request different subsets; per-ref filtering keeps
  // each diff entry's snapshot scoped to what the config declared.
  const pickSnapshot = (
    fullSnapshot: Record<string, unknown> | undefined,
    displayColumns: readonly string[]
  ): Record<string, unknown> | undefined => {
    if (!fullSnapshot) return undefined;
    const picked: Record<string, unknown> = {};
    for (const col of displayColumns) {
      if (col in fullSnapshot) picked[col] = fullSnapshot[col];
    }
    return Object.keys(picked).length > 0 ? picked : undefined;
  };

  for (const ref of refs) {
    const oldVal = ref.diffEntry.old;
    const newVal = ref.diffEntry.new;
    const oldSnap =
      typeof oldVal === "string"
        ? pickSnapshot(
            lookup.get(`${ref.table}::${oldVal}`),
            ref.displayColumns
          )
        : undefined;
    const newSnap =
      typeof newVal === "string"
        ? pickSnapshot(
            lookup.get(`${ref.table}::${newVal}`),
            ref.displayColumns
          )
        : undefined;
    if (oldSnap || newSnap) {
      ref.diffEntry.snapshot = {
        ...(oldSnap && { old: oldSnap }),
        ...(newSnap && { new: newSnap })
      };
    }
  }
}
