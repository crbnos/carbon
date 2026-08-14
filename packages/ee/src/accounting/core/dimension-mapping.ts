import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import type { ExternalIntegrationMapping } from "./external-mapping";
import { createMappingService } from "./external-mapping";
import type { PostingSyncDimensionSlot } from "./models";
import type { JournalLineDimensionRef } from "./posting";
import type { DimensionTarget } from "./types";

/**
 * Dimension-value mapping service: thin wrappers over
 * ExternalIntegrationMappingService with entityType = "dimensionValue",
 * linking Carbon dimension VALUES to provider analytics options (QBO
 * Class/Department entities, Xero tracking options, Rillet Field values).
 *
 * The Carbon side of a mapping is the composite `<dimensionId>:<valueId>`
 * — valueId alone is polymorphic across entity-typed dimensions
 * (location.id, supplier.id, item.id, dimensionValue.id, …), so the
 * composite key is required. The provider side is the option id in
 * `externalId`, with the display name in metadata — exactly like account
 * mapping (core/account-mapping.ts).
 *
 * What crosses the wire to a provider is always the RESOLVED provider
 * option id; Carbon's internal value ids never leave. Provider-side
 * creation (autoCreate) is always BY NAME — the READABLE label resolved
 * per the dimension's entityType (resolveDimensionValueLabels, mirroring
 * DimensionSelector.tsx / getEntityValuesByIds in the accounting module).
 */

export const DIMENSION_VALUE_MAPPING_ENTITY_TYPE = "dimensionValue";

type Db = Kysely<KyselyDatabase> | KyselyTx;

/** `<dimensionId>:<valueId>` — the mapping row's entityId. */
export function buildDimensionValueMappingEntityId(
  dimensionId: string,
  valueId: string
): string {
  return `${dimensionId}:${valueId}`;
}

/** Split a mapping entityId back into `{ dimensionId, valueId }` (null when malformed). */
export function parseDimensionValueMappingEntityId(
  entityId: string
): JournalLineDimensionRef | null {
  const separator = entityId.indexOf(":");
  if (separator <= 0 || separator === entityId.length - 1) return null;
  return {
    dimensionId: entityId.slice(0, separator),
    valueId: entityId.slice(separator + 1)
  };
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A dimension-value mapping row shaped for display / lookup.
 */
export interface DimensionValueMapping {
  id: string;
  dimensionId: string;
  valueId: string;
  externalId: string | null;
  externalName: string | null;
  lastSyncedAt: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * A Carbon dimension value with its resolved READABLE label (part
 * readable id for Item dimensions, name for everything else).
 */
export interface DimensionValueWithLabel extends JournalLineDimensionRef {
  label: string | null;
}

/**
 * A proposed (not written) match between a Carbon dimension value and a
 * provider option. The UI confirms proposals and calls
 * upsertDimensionValueMapping.
 */
export interface DimensionValueMatchProposal {
  dimensionId: string;
  valueId: string;
  label: string;
  externalId: string;
  externalName: string | null;
}

function getExternalNameFromMetadata(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const { externalName } = metadata as Record<string, unknown>;
  return typeof externalName === "string" ? externalName : null;
}

/**
 * All dimension-value mappings for an integration (optionally one
 * dimension), parsed out of the composite entityId. Malformed rows are
 * skipped.
 */
export async function getDimensionValueMappings(
  db: Db,
  args: { companyId: string; integration: string; dimensionId?: string }
): Promise<{ data: DimensionValueMapping[] | null; error: string | null }> {
  try {
    const rows = await db
      .selectFrom("externalIntegrationMapping")
      .select(["id", "entityId", "externalId", "metadata", "lastSyncedAt"])
      .where("entityType", "=", DIMENSION_VALUE_MAPPING_ENTITY_TYPE)
      .where("integration", "=", args.integration)
      .where("companyId", "=", args.companyId)
      .execute();

    const data: DimensionValueMapping[] = [];
    for (const row of rows) {
      const parsed = parseDimensionValueMappingEntityId(row.entityId);
      if (!parsed) continue;
      if (args.dimensionId && parsed.dimensionId !== args.dimensionId) {
        continue;
      }
      data.push({
        id: row.id,
        dimensionId: parsed.dimensionId,
        valueId: parsed.valueId,
        externalId: row.externalId ?? null,
        externalName: getExternalNameFromMetadata(row.metadata),
        lastSyncedAt: (row.lastSyncedAt as string | null) ?? null,
        metadata: (row.metadata as Record<string, unknown> | null) ?? null
      });
    }

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toErrorMessage(err) };
  }
}

/**
 * Lookup used by pre-flight and the provider mappers:
 * `<dimensionId>:<valueId>` → provider option id. Mappings without a
 * stored externalId count as unmapped.
 */
export function buildDimensionValueMappingLookup(
  mappings: ReadonlyArray<DimensionValueMapping>
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const mapping of mappings) {
    if (mapping.externalId) {
      lookup.set(
        buildDimensionValueMappingEntityId(
          mapping.dimensionId,
          mapping.valueId
        ),
        mapping.externalId
      );
    }
  }
  return lookup;
}

/**
 * Upsert a dimension-value mapping (`<dimensionId>:<valueId>` → provider
 * option id). Several Carbon values may legitimately share one provider
 * option (consolidation), so duplicate external ids are allowed — the
 * same stance as account mapping.
 */
export async function upsertDimensionValueMapping(
  db: Db,
  args: {
    companyId: string;
    integration: string;
    dimensionId: string;
    valueId: string;
    externalId: string;
    externalName?: string;
    userId?: string;
  }
): Promise<{ data: ExternalIntegrationMapping | null; error: string | null }> {
  try {
    const mappingService = createMappingService(db, args.companyId);
    const entityId = buildDimensionValueMappingEntityId(
      args.dimensionId,
      args.valueId
    );

    await mappingService.link(
      DIMENSION_VALUE_MAPPING_ENTITY_TYPE,
      entityId,
      args.integration,
      args.externalId,
      {
        ...(args.externalName
          ? { metadata: { externalName: args.externalName } }
          : {}),
        ...(args.userId ? { createdBy: args.userId } : {}),
        allowDuplicateExternalId: true
      }
    );

    const data = await mappingService.getByEntity(
      DIMENSION_VALUE_MAPPING_ENTITY_TYPE,
      entityId,
      args.integration
    );

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toErrorMessage(err) };
  }
}

/**
 * Dimension → provider FIELD mapping service (entityType "dimension"),
 * mirroring the value service above. The Carbon side is the plain
 * `dimensionId`; the provider side is the Field/dimension id in `externalId`
 * (Rillet Field uuid). Used by the "send all dimensions" flow to auto-
 * provision a provider Field per Carbon dimension, so a value mapping always
 * has a Field to hang off of.
 */
export const DIMENSION_MAPPING_ENTITY_TYPE = "dimension";

/** A dimension → provider Field mapping row. */
export interface DimensionFieldMapping {
  id: string;
  dimensionId: string;
  externalId: string | null;
  externalName: string | null;
}

/** All dimension → provider Field mappings for an integration. */
export async function getDimensionMappings(
  db: Db,
  args: { companyId: string; integration: string }
): Promise<{ data: DimensionFieldMapping[] | null; error: string | null }> {
  try {
    const rows = await db
      .selectFrom("externalIntegrationMapping")
      .select(["id", "entityId", "externalId", "metadata"])
      .where("entityType", "=", DIMENSION_MAPPING_ENTITY_TYPE)
      .where("integration", "=", args.integration)
      .where("companyId", "=", args.companyId)
      .execute();

    const data = rows.map((row) => ({
      id: row.id,
      dimensionId: row.entityId,
      externalId: row.externalId ?? null,
      externalName: getExternalNameFromMetadata(row.metadata)
    }));

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toErrorMessage(err) };
  }
}

/** `dimensionId` → provider Field id. Rows without an externalId are unmapped. */
export function buildDimensionFieldLookup(
  mappings: ReadonlyArray<DimensionFieldMapping>
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const mapping of mappings) {
    if (mapping.externalId) lookup.set(mapping.dimensionId, mapping.externalId);
  }
  return lookup;
}

/**
 * Upsert a dimension → provider Field mapping (dimensionId → Field id). Two
 * Carbon dimensions that share a name may resolve to one provider Field
 * (auto-provision reuses an existing Field by name), so duplicate external
 * ids are allowed — the same stance as the value + account mappings.
 */
export async function upsertDimensionMapping(
  db: Db,
  args: {
    companyId: string;
    integration: string;
    dimensionId: string;
    externalId: string;
    externalName?: string;
    userId?: string;
  }
): Promise<{ data: ExternalIntegrationMapping | null; error: string | null }> {
  try {
    const mappingService = createMappingService(db, args.companyId);

    await mappingService.link(
      DIMENSION_MAPPING_ENTITY_TYPE,
      args.dimensionId,
      args.integration,
      args.externalId,
      {
        ...(args.externalName
          ? { metadata: { externalName: args.externalName } }
          : {}),
        ...(args.userId ? { createdBy: args.userId } : {}),
        allowDuplicateExternalId: true
      }
    );

    const data = await mappingService.getByEntity(
      DIMENSION_MAPPING_ENTITY_TYPE,
      args.dimensionId,
      args.integration
    );

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toErrorMessage(err) };
  }
}

/**
 * `dimensionId` → dimension name, for auto-provisioning provider Fields by
 * name. Queries `dimension` by id (already company-scoped by provenance —
 * the ids come from the company's journal lines), mirroring how
 * resolveDimensionValueLabels reads the dimension table.
 */
export async function loadDimensionNames(
  db: Db,
  args: { dimensionIds: ReadonlyArray<string> }
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (args.dimensionIds.length === 0) return names;

  const rows = await db
    .selectFrom("dimension")
    .select(["id", "name"])
    .where("id", "in", [...args.dimensionIds])
    .execute();

  for (const row of rows) {
    if (typeof row.name === "string" && row.name) names.set(row.id, row.name);
  }
  return names;
}

/**
 * Propose matches where a Carbon dimension value's resolved label equals
 * a provider option name EXACTLY (no trimming, no case folding).
 * Ambiguous candidates are skipped: duplicate labels among the values,
 * duplicate names among the provider options, values already mapped, and
 * provider options already used by a mapping. Pure — the UI confirms
 * proposals and calls upsertDimensionValueMapping.
 */
export function matchDimensionValuesByName(args: {
  values: ReadonlyArray<DimensionValueWithLabel>;
  providerOptions: ReadonlyArray<{ id: string; name: string | null }>;
  mappedValueKeys?: Iterable<string>;
  mappedExternalIds?: Iterable<string>;
}): DimensionValueMatchProposal[] {
  const mappedValueKeys = new Set(args.mappedValueKeys ?? []);
  const mappedExternalIds = new Set(args.mappedExternalIds ?? []);

  const optionsByName = new Map<string, { id: string; name: string }>();
  const ambiguousNames = new Set<string>();
  for (const option of args.providerOptions) {
    if (!option.name) continue;
    if (optionsByName.has(option.name)) {
      ambiguousNames.add(option.name);
      continue;
    }
    optionsByName.set(option.name, { id: option.id, name: option.name });
  }

  const labelCounts = new Map<string, number>();
  for (const value of args.values) {
    if (!value.label) continue;
    labelCounts.set(value.label, (labelCounts.get(value.label) ?? 0) + 1);
  }

  const proposals: DimensionValueMatchProposal[] = [];
  for (const value of args.values) {
    if (!value.label) continue;
    const key = buildDimensionValueMappingEntityId(
      value.dimensionId,
      value.valueId
    );
    if (mappedValueKeys.has(key)) continue;
    if ((labelCounts.get(value.label) ?? 0) > 1) continue;
    if (ambiguousNames.has(value.label)) continue;

    const option = optionsByName.get(value.label);
    if (!option) continue;
    if (mappedExternalIds.has(option.id)) continue;

    proposals.push({
      dimensionId: value.dimensionId,
      valueId: value.valueId,
      label: value.label,
      externalId: option.id,
      externalName: option.name
    });
  }

  return proposals;
}

// /********************************************************\
// *          Label resolution (Carbon-side, readable)      *
// \********************************************************/

/**
 * The source table + label column per dimension entityType. Mirrors
 * `getEntityValuesByIds` in apps/erp accounting.ee.service.ts and the
 * DimensionSelector's client-store resolution (WorkCenter/Process). The
 * Item label is the READABLE part id (readableIdWithRevision), never the
 * internal id.
 */
type LabelSource = { table: string; labelColumn: string };

const DIMENSION_LABEL_SOURCES: Record<string, LabelSource> = {
  Custom: { table: "dimensionValue", labelColumn: "name" },
  Location: { table: "location", labelColumn: "name" },
  Department: { table: "department", labelColumn: "name" },
  Employee: { table: "employeeSummary", labelColumn: "name" },
  CustomerType: { table: "customerType", labelColumn: "name" },
  SupplierType: { table: "supplierType", labelColumn: "name" },
  ItemPostingGroup: { table: "itemPostingGroup", labelColumn: "name" },
  CostCenter: { table: "costCenter", labelColumn: "name" },
  FixedAssetClass: { table: "fixedAssetClass", labelColumn: "name" },
  Customer: { table: "customer", labelColumn: "name" },
  Supplier: { table: "supplier", labelColumn: "name" },
  Item: { table: "item", labelColumn: "readableIdWithRevision" },
  WorkCenter: { table: "workCenter", labelColumn: "name" },
  Process: { table: "process", labelColumn: "name" }
};

/**
 * Resolve the READABLE labels for a set of dimension values, keyed
 * `<dimensionId>:<valueId>`. The dimension's entityType picks the source
 * table (see DIMENSION_LABEL_SOURCES); Custom dimensions resolve through
 * `dimensionValue`. Values whose entity row no longer exists are simply
 * absent from the result (the caller degrades: unmapped → warn/drop).
 * Throws on DB failure — callers are syncers whose push fails loudly.
 */
export async function resolveDimensionValueLabels(
  db: Db,
  args: { values: ReadonlyArray<JournalLineDimensionRef> }
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (args.values.length === 0) return labels;

  const dimensionIds = [...new Set(args.values.map((v) => v.dimensionId))];
  const dimensions = await db
    .selectFrom("dimension")
    .select(["id", "entityType"])
    .where("id", "in", dimensionIds)
    .execute();
  const entityTypeByDimensionId = new Map(
    dimensions.map((dimension) => [dimension.id, String(dimension.entityType)])
  );

  // Group value ids per entityType (one query per source table)
  const valueIdsByEntityType = new Map<string, Set<string>>();
  for (const value of args.values) {
    const entityType = entityTypeByDimensionId.get(value.dimensionId);
    if (!entityType) continue;
    let ids = valueIdsByEntityType.get(entityType);
    if (!ids) {
      ids = new Set<string>();
      valueIdsByEntityType.set(entityType, ids);
    }
    ids.add(value.valueId);
  }

  const labelByValueId = new Map<string, string>();
  for (const [entityType, ids] of valueIdsByEntityType) {
    const source = DIMENSION_LABEL_SOURCES[entityType];
    if (!source) continue;

    const rows = await (db as Kysely<KyselyDatabase>)
      .selectFrom(source.table as never)
      .select([`${source.table}.id` as never, source.labelColumn as never])
      .where(`${source.table}.id` as never, "in" as never, [...ids] as never)
      .execute();

    for (const row of rows as Array<Record<string, unknown>>) {
      const id = row.id;
      const label = row[source.labelColumn];
      if (typeof id === "string" && typeof label === "string" && label) {
        labelByValueId.set(id, label);
      }
    }
  }

  for (const value of args.values) {
    const label = labelByValueId.get(value.valueId);
    if (label !== undefined) {
      labels.set(
        buildDimensionValueMappingEntityId(value.dimensionId, value.valueId),
        label
      );
    }
  }

  return labels;
}

/**
 * The dimensions stamped on a set of journal lines, keyed by
 * journalLine.id — the fetchLocal join every provider journal syncer
 * runs (spec: `fetchLocal` joins `journalLineDimension`).
 */
export async function loadJournalLineDimensions(
  db: Db,
  args: { companyId: string; journalLineIds: ReadonlyArray<string> }
): Promise<Map<string, JournalLineDimensionRef[]>> {
  const byLine = new Map<string, JournalLineDimensionRef[]>();
  if (args.journalLineIds.length === 0) return byLine;

  const rows = await db
    .selectFrom("journalLineDimension")
    .select(["journalLineId", "dimensionId", "valueId"])
    .where("companyId", "=", args.companyId)
    .where("journalLineId", "in", [...args.journalLineIds])
    .orderBy("dimensionId", "asc")
    .execute();

  for (const row of rows) {
    const existing = byLine.get(row.journalLineId);
    const ref = { dimensionId: row.dimensionId, valueId: row.valueId };
    if (existing) {
      existing.push(ref);
    } else {
      byLine.set(row.journalLineId, [ref]);
    }
  }

  return byLine;
}

/**
 * Distinct dimension values present on POSTED journal lines for the
 * slot-configured dimensions, minus already-mapped values, with resolved
 * labels — the settings UI's unmapped-first value-mapping table source.
 */
export async function getUnmappedSlottedDimensionValues(
  db: Db,
  args: {
    companyId: string;
    integration: string;
    slots: ReadonlyArray<Pick<PostingSyncDimensionSlot, "dimensionId">>;
  }
): Promise<{ data: DimensionValueWithLabel[] | null; error: string | null }> {
  try {
    const slottedDimensionIds = [
      ...new Set(args.slots.map((slot) => slot.dimensionId))
    ];
    if (slottedDimensionIds.length === 0) {
      return { data: [], error: null };
    }

    const rows = await db
      .selectFrom("journalLineDimension as jld")
      .innerJoin("journalLine as jl", "jl.id", "jld.journalLineId")
      .innerJoin("journal as j", "j.id", "jl.journalId")
      .select(["jld.dimensionId", "jld.valueId"])
      .distinct()
      .where("jld.companyId", "=", args.companyId)
      .where("j.companyId", "=", args.companyId)
      .where("j.status", "=", "Posted")
      .where("jld.dimensionId", "in", slottedDimensionIds)
      .execute();

    const mappings = await getDimensionValueMappings(db, {
      companyId: args.companyId,
      integration: args.integration
    });
    if (mappings.error) {
      return { data: null, error: mappings.error };
    }
    const mapped = buildDimensionValueMappingLookup(mappings.data ?? []);

    const unmapped: JournalLineDimensionRef[] = rows
      .map((row) => ({ dimensionId: row.dimensionId, valueId: row.valueId }))
      .filter(
        (value) =>
          !mapped.get(
            buildDimensionValueMappingEntityId(value.dimensionId, value.valueId)
          )
      );

    const labels = await resolveDimensionValueLabels(db, { values: unmapped });

    const data = unmapped
      .map((value) => ({
        ...value,
        label:
          labels.get(
            buildDimensionValueMappingEntityId(value.dimensionId, value.valueId)
          ) ?? null
      }))
      .sort(
        (a, b) =>
          a.dimensionId.localeCompare(b.dimensionId) ||
          (a.label ?? "").localeCompare(b.label ?? "")
      );

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toErrorMessage(err) };
  }
}

// /********************************************************\
// *              Slot-config validation                    *
// \********************************************************/

/**
 * Validate a dimension-slot configuration against the provider's declared
 * targets. Errors (empty = valid): a dimension slotted more than once, a
 * target the provider does not declare, a target used beyond its capacity
 * (default 1), and more slots than the provider's structural cap.
 */
export function validateDimensionSlots(args: {
  slots: ReadonlyArray<
    Pick<PostingSyncDimensionSlot, "dimensionId" | "target">
  >;
  targets: ReadonlyArray<DimensionTarget>;
  /** ProviderCapabilities.maxJournalDimensionSlots (or a provider constant). */
  maxSlots?: number;
}): string[] {
  const errors: string[] = [];

  if (args.maxSlots !== undefined && args.slots.length > args.maxSlots) {
    errors.push(
      `Too many dimension slots: ${args.slots.length} configured, the provider supports at most ${args.maxSlots}.`
    );
  }

  const targetsById = new Map(
    args.targets.map((target) => [target.id, target])
  );

  const slotCountByDimension = new Map<string, number>();
  const slotCountByTarget = new Map<string, number>();
  for (const slot of args.slots) {
    slotCountByDimension.set(
      slot.dimensionId,
      (slotCountByDimension.get(slot.dimensionId) ?? 0) + 1
    );
    slotCountByTarget.set(
      slot.target,
      (slotCountByTarget.get(slot.target) ?? 0) + 1
    );
    if (!targetsById.has(slot.target)) {
      errors.push(
        `Unknown provider target "${slot.target}" — the provider does not offer it.`
      );
    }
  }

  for (const [dimensionId, count] of slotCountByDimension) {
    if (count > 1) {
      errors.push(
        `Dimension ${dimensionId} is slotted ${count} times; each dimension may map to at most one provider target.`
      );
    }
  }

  for (const [targetId, count] of slotCountByTarget) {
    const target = targetsById.get(targetId);
    if (!target) continue;
    const capacity = target.capacity ?? 1;
    if (count > capacity) {
      errors.push(
        `Provider target "${targetId}" is used by ${count} slots; it supports at most ${capacity}.`
      );
    }
  }

  return errors;
}

/**
 * Effective autoCreate for a slot: the stored flag when present, else the
 * provider default (Rillet: true — Field-value upsert is the expected
 * flow; QBO/Xero: false — opt-in avoids surprise writes).
 */
export function resolveDimensionSlotAutoCreate(
  slot: Pick<PostingSyncDimensionSlot, "autoCreate">,
  providerDefault: boolean
): boolean {
  return slot.autoCreate ?? providerDefault;
}

// /********************************************************\
// *          autoCreate orchestration (per push)           *
// \********************************************************/

/**
 * Ensure every slotted dimension value on the journal's lines has a
 * provider option id, creating missing provider options BY NAME for
 * autoCreate slots. Provider-agnostic: the caller injects the provider
 * write (`createExternalValue`) and the mapping persist; `mappings` is
 * updated IN PLACE so the subsequent pre-flight and mapper see the new
 * ids. Values whose label cannot be resolved (source entity deleted) are
 * left unmapped — the warn/drop policy handles them downstream.
 */
export async function ensureDimensionValueExternalIds(args: {
  lines: ReadonlyArray<{
    dimensions?: JournalLineDimensionRef[] | null;
  }>;
  slots: ReadonlyArray<PostingSyncDimensionSlot>;
  /** Provider default for slots without an explicit autoCreate flag. */
  defaultAutoCreate: boolean;
  /** `<dimensionId>:<valueId>` → provider option id; mutated in place. */
  mappings: Map<string, string>;
  resolveLabels: (
    values: ReadonlyArray<JournalLineDimensionRef>
  ) => Promise<Map<string, string>>;
  /** Create the provider option by NAME; returns its provider id. */
  createExternalValue: (
    slot: PostingSyncDimensionSlot,
    label: string
  ) => Promise<string>;
  persistMapping: (
    value: JournalLineDimensionRef,
    externalId: string,
    label: string
  ) => Promise<void>;
}): Promise<{
  created: Array<
    JournalLineDimensionRef & { externalId: string; label: string }
  >;
}> {
  const created: Array<
    JournalLineDimensionRef & { externalId: string; label: string }
  > = [];

  const autoCreateSlotsByDimension = new Map<
    string,
    PostingSyncDimensionSlot
  >();
  for (const slot of args.slots) {
    if (resolveDimensionSlotAutoCreate(slot, args.defaultAutoCreate)) {
      autoCreateSlotsByDimension.set(slot.dimensionId, slot);
    }
  }
  if (autoCreateSlotsByDimension.size === 0) return { created };

  // Distinct unmapped values on autoCreate slots
  const pending = new Map<string, JournalLineDimensionRef>();
  for (const line of args.lines) {
    for (const dimension of line.dimensions ?? []) {
      if (!autoCreateSlotsByDimension.has(dimension.dimensionId)) continue;
      const key = buildDimensionValueMappingEntityId(
        dimension.dimensionId,
        dimension.valueId
      );
      if (args.mappings.get(key)) continue;
      if (!pending.has(key)) {
        pending.set(key, {
          dimensionId: dimension.dimensionId,
          valueId: dimension.valueId
        });
      }
    }
  }
  if (pending.size === 0) return { created };

  const labels = await args.resolveLabels([...pending.values()]);

  for (const [key, value] of pending) {
    const label = labels.get(key);
    if (!label) continue; // unresolvable → warn/drop downstream

    const slot = autoCreateSlotsByDimension.get(value.dimensionId);
    if (!slot) continue;

    const externalId = await args.createExternalValue(slot, label);
    await args.persistMapping(value, externalId, label);
    args.mappings.set(key, externalId);
    created.push({ ...value, externalId, label });
  }

  return { created };
}
