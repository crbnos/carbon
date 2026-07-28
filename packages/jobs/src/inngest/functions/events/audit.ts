import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type {
  SnapshotFieldEntry,
  TableConfig
} from "@carbon/database/audit.config";
import {
  getAuditableTableNames,
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
import { getLogger } from "@carbon/logger";
import { groupBy } from "@carbon/utils";
import { z } from "zod";
import { inngest } from "../../client";
import { computeCreateDiff, computeDiff } from "./diff";
import type { FkMap, FkMapRow } from "./fk-snapshots";
import { parseFkMapRows, resolveSnapshotSpec } from "./fk-snapshots";

const log = getLogger("jobs", "audit");

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
  async ({ event, step, logger }) => {
    const payload = AuditPayloadSchema.parse(event.data);

    logger.info(`Processing ${payload.records.length} audit log events`);

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
        logger.info(`Skipping ${records.length} records: missing companyId`);
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
          logger.info(
            `Skipping ${records.length} records: audit logging disabled for company ${companyId}`
          );
          stepResults.skipped += records.length;
          return stepResults;
        }

        const entries: CreateAuditLogEntry[] = [];

        for (const record of records) {
          const tableName = record.event.table;

          if (!isAuditableTable(tableName)) {
            logger.info(`Skipping: table "${tableName}" is not auditable`);
            stepResults.skipped++;
            continue;
          }

          if (record.event.operation === "TRUNCATE") {
            logger.info(
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
                logger.info(
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
              logger.info(
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
                logger.info(
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
                  logger.info(
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
              stepResults.skipped++;
            }
          } catch (error) {
            logger.error("Failed to process audit record", {
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
            logger.error("Failed to insert audit log entries", { error });
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

    logger.info("Audit function completed", results);

    return results;
  }
);

/**
 * FK topology of the audited tables, fetched once per process from the
 * `get_foreign_key_map` RPC (which reads pg_constraint). Cached forever:
 * schema only changes on deploys, which restart the worker. Failures are
 * not cached, so the next batch retries the fetch.
 */
let fkMapCache: FkMap | null = null;

async function getFkMap(
  client: ReturnType<typeof getCarbonServiceRole>
): Promise<FkMap> {
  if (fkMapCache) return fkMapCache;
  try {
    const { data, error } = await (client as any).rpc("get_foreign_key_map", {
      p_table_names: getAuditableTableNames()
    });
    if (error || !data) {
      log.error(
        "get_foreign_key_map failed; only declared snapshotFields will resolve",
        { error }
      );
      return new Map();
    }
    fkMapCache = parseFkMapRows(data as FkMapRow[]);
    return fkMapCache;
  } catch (err) {
    log.error(
      "get_foreign_key_map threw; only declared snapshotFields will resolve",
      {
        error: err
      }
    );
    return new Map();
  }
}

/**
 * For every FK column that changed, look up the FK target's display columns
 * and freeze them onto the diff entry under `snapshot.old` / `snapshot.new`.
 * FK columns are discovered from the schema (`getFkMap`) with display
 * columns from `fkDisplayRegistry`; per-column `snapshotFields` overrides
 * win. One batched query per target table — proportional to distinct FK
 * targets, not to entries.
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
  const companyScopedByTable = new Map<string, boolean>();
  const fkMap = await getFkMap(client);

  for (const entry of entries) {
    if (!entry.diff) continue;

    const overrides = new Map<string, SnapshotFieldEntry>();
    const configs = getEntityConfigsForTable(entry.tableName).filter(
      (c) => c.entityType === entry.entityType
    );
    for (const { tableConfig } of configs) {
      for (const snap of getSnapshotFields(tableConfig as TableConfig)) {
        overrides.set(snap.column, snap);
      }
    }

    for (const [column, change] of Object.entries(entry.diff)) {
      if (!change) continue;
      const spec = resolveSnapshotSpec(
        entry.tableName,
        column,
        overrides,
        fkMap
      );
      if (!spec) continue;

      refs.push({
        diffEntry: change,
        table: spec.table,
        displayColumns: spec.displayColumns
      });

      const ids = idsByTable.get(spec.table) ?? new Set<string>();
      if (typeof change.old === "string") ids.add(change.old);
      if (typeof change.new === "string") ids.add(change.new);
      idsByTable.set(spec.table, ids);

      const cols = colsByTable.get(spec.table) ?? new Set<string>();
      for (const c of spec.displayColumns) cols.add(c);
      colsByTable.set(spec.table, cols);

      companyScopedByTable.set(spec.table, spec.hasCompanyId);
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
      let query = (client as any)
        .from(table)
        .select(selectClause)
        .in("id", Array.from(ids));
      // Tenant-scope the lookup unless the target table has no companyId
      // (e.g. "user" — global identity).
      if (companyScopedByTable.get(table) !== false) {
        query = query.eq("companyId", companyId);
      }
      const { data, error } = await query;

      if (error || !data) continue;

      for (const row of data as Array<Record<string, unknown>>) {
        const rowId = row?.id;
        if (typeof rowId !== "string") continue;
        const snapshot: Record<string, unknown> = {};
        for (const col of cols) snapshot[col] = row[col];
        lookup.set(`${table}::${rowId}`, snapshot);
      }
    } catch (err) {
      log.error(`FK snapshot lookup failed for table "${table}"`, {
        error: err
      });
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
