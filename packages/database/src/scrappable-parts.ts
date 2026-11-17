// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What an operator can scrap at an operation and replace from the shelf: for
// each material of the operation's make method (and the parts of a kit made
// on the job), the material's own part, or, for a kit pulled from the rack,
// the parts inside it. An untracked part is scrapped by count; a tracked one
// by the serial or batch that was used: those consumed into the material, or
// into a kit serial consumed into it. Every MES view lists these and the
// scrapJobPart posting checks against them.

import type { Kysely, KyselyDatabase } from "./client.ts";

export type ScrappablePart = {
  itemId: string;
  readableId: string;
  name: string;
  /** Per kit, for a part inside a kit; null for the material's own part. */
  perKit: number | null;
};

/** A serial or batch used on the operation, to scrap by its own identity. */
export type ScrappableEntity = {
  trackedEntityId: string;
  /** The serial or batch number. */
  readableId: string;
  itemId: string;
  itemReadableId: string;
  name: string;
  trackingType: "Serial" | "Batch";
  quantity: number;
  /** What it was consumed into: the unit, or a kit serial. */
  parentEntityId: string | null;
  /** The kit serial it sits in, for a part inside a kit. */
  kitReadableId: string | null;
};

export type ScrappableMaterial = {
  id: string;
  readableId: string;
  name: string;
  isKit: boolean;
  parts: ScrappablePart[];
  tracked: ScrappableEntity[];
};

export type ScrappableOperation = {
  jobId: string;
  jobMakeMethodId: string;
  locationId: string;
  projectId: string | null;
  workCenterId: string | null;
  materials: ScrappableMaterial[];
};

export async function getScrappableParts(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; jobOperationId: string }
): Promise<ScrappableOperation | null> {
  const { companyId } = args;
  const operation = await db
    .selectFrom("jobOperation as o")
    .innerJoin("job as j", "j.id", "o.jobId")
    .where("o.id", "=", args.jobOperationId)
    .where("o.companyId", "=", companyId)
    .select([
      "o.jobId",
      "o.jobMakeMethodId",
      "o.workCenterId",
      "j.locationId",
      "j.projectId"
    ])
    .executeTakeFirst();
  if (
    !operation?.jobId ||
    !operation.jobMakeMethodId ||
    !operation.locationId
  ) {
    return null;
  }
  const jobMakeMethodId = operation.jobMakeMethodId;
  const locationId = operation.locationId;

  const materials = await db
    .selectFrom("jobMaterial as jm")
    .innerJoin("item as i", "i.id", "jm.itemId")
    .where("jm.companyId", "=", companyId)
    .where((eb) =>
      eb.or([
        eb("jm.jobMakeMethodId", "=", operation.jobMakeMethodId),
        // A kit made on the job lists its parts under its own make method.
        eb(
          "jm.jobMakeMethodId",
          "in",
          eb
            .selectFrom("jobMakeMethod as jmm")
            .innerJoin("jobMaterial as kit", "kit.id", "jmm.parentMaterialId")
            .where("kit.jobMakeMethodId", "=", operation.jobMakeMethodId)
            .where("kit.kit", "=", true)
            .select("jmm.id")
        )
      ])
    )
    .where("jm.methodType", "<>", "Make to Order")
    .select(({ exists, selectFrom }) => [
      "jm.id",
      "jm.itemId",
      "jm.methodType",
      "i.readableIdWithRevision",
      "i.name",
      "i.itemTrackingType",
      // A kit pulled from stock: its shelf slot at the location is a kit rack
      // (line feed lanes).
      exists(
        selectFrom("pickMethod as pm")
          .innerJoin("storageUnit as su", "su.id", "pm.defaultStorageUnitId")
          .whereRef("pm.itemId", "=", "jm.itemId")
          .where("pm.locationId", "=", locationId)
          .where("pm.companyId", "=", companyId)
          .where("su.kitRack", "=", true)
          .select("pm.itemId")
      ).as("isKit")
    ])
    .orderBy("i.readableIdWithRevision")
    .execute();

  const kitItemIds = [
    ...new Set(
      materials
        .filter((m) => m.isKit && m.methodType === "Pull from Inventory")
        .map((m) => m.itemId!)
    )
  ];
  // Each kit's parts, from its active make method (else its latest draft).
  const kitParts = kitItemIds.length
    ? await db
        .with("method", (qb) =>
          qb
            .selectFrom("makeMethod as m")
            .where("m.itemId", "in", kitItemIds)
            .where("m.companyId", "=", companyId)
            .where("m.status", "<>", "Archived")
            .distinctOn("m.itemId")
            .orderBy("m.itemId")
            .orderBy((eb) => eb("m.status", "=", "Active"), "desc")
            .orderBy("m.version", "desc")
            .select(["m.id", "m.itemId"])
        )
        .selectFrom("method")
        .innerJoin("methodMaterial as mm", "mm.makeMethodId", "method.id")
        .innerJoin("item as i", "i.id", "mm.itemId")
        .where("mm.methodType", "=", "Pull from Inventory")
        .where("i.itemTrackingType", "=", "Inventory")
        .groupBy([
          "method.itemId",
          "mm.itemId",
          "i.readableIdWithRevision",
          "i.name"
        ])
        .select((eb) => [
          "method.itemId as kitItemId",
          "mm.itemId",
          "i.readableIdWithRevision",
          "i.name",
          eb.fn.sum<string>("mm.quantity").as("perKit")
        ])
        .orderBy("i.readableIdWithRevision")
        .execute()
    : [];
  const partsByKit = new Map<string, ScrappablePart[]>();
  for (const part of kitParts) {
    const list = partsByKit.get(part.kitItemId!) ?? [];
    list.push({
      itemId: part.itemId!,
      readableId: part.readableIdWithRevision ?? "",
      name: part.name ?? "",
      perKit: Number(part.perKit)
    });
    partsByKit.set(part.kitItemId!, list);
  }

  const tracked = await consumedEntities(db, {
    companyId,
    materialIds: materials.map((m) => m.id!)
  });
  const kitMaterialIds = new Set(
    materials
      .filter((m) => m.isKit && m.methodType === "Pull from Inventory")
      .map((m) => m.id!)
  );
  // The kit serials themselves are not offered: the parts inside them are.
  const kitEntities = tracked.filter((e) => kitMaterialIds.has(e.materialId));
  const inKits = await consumedEntities(db, {
    companyId,
    parentEntityIds: kitEntities.map((e) => e.trackedEntityId)
  });
  const kitByEntity = new Map(kitEntities.map((e) => [e.trackedEntityId, e]));
  const trackedByMaterial = new Map<string, ScrappableEntity[]>();
  const add = (materialId: string, entity: ScrappableEntity) =>
    trackedByMaterial.set(materialId, [
      ...(trackedByMaterial.get(materialId) ?? []),
      entity
    ]);
  for (const e of tracked) {
    if (!kitMaterialIds.has(e.materialId)) add(e.materialId, e);
  }
  for (const e of inKits) {
    const kit = kitByEntity.get(e.parentEntityId!);
    if (kit) add(kit.materialId, { ...e, kitReadableId: kit.readableId });
  }

  return {
    jobId: operation.jobId,
    jobMakeMethodId,
    locationId,
    projectId: operation.projectId ?? null,
    workCenterId: operation.workCenterId ?? null,
    materials: materials
      .map((m) => {
        const isKit =
          Boolean(m.isKit) && m.methodType === "Pull from Inventory";
        // A kit itself is not a part to scrap and replace: its parts are.
        const parts: ScrappablePart[] = isKit
          ? (partsByKit.get(m.itemId!) ?? [])
          : m.itemTrackingType === "Inventory"
            ? [
                {
                  itemId: m.itemId!,
                  readableId: m.readableIdWithRevision ?? "",
                  name: m.name ?? "",
                  perKit: null
                }
              ]
            : [];
        return {
          id: m.id!,
          readableId: m.readableIdWithRevision ?? "",
          name: m.name ?? "",
          isKit,
          parts,
          tracked: trackedByMaterial.get(m.id!) ?? []
        };
      })
      .filter((m) => m.parts.length > 0 || m.tracked.length > 0)
  };
}

/**
 * Serials and batches still consumed (not scrapped or given back), by the
 * latest Consume activity that used each: those consumed into the materials,
 * or those consumed into the parent entities (a kit serial's parts).
 */
async function consumedEntities(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string } & (
    | { materialIds: string[] }
    | { parentEntityIds: string[] }
  )
): Promise<(ScrappableEntity & { materialId: string })[]> {
  const byMaterial = "materialIds" in args;
  const ids = byMaterial ? args.materialIds : args.parentEntityIds;
  if (ids.length === 0) return [];
  const rows = await db
    .selectFrom("trackedActivity as a")
    .innerJoin("trackedActivityInput as ai", "ai.trackedActivityId", "a.id")
    .innerJoin("trackedEntity as e", "e.id", "ai.trackedEntityId")
    .innerJoin("item as i", (join) =>
      join.on((eb) =>
        eb("i.id", "=", eb.fn.coalesce("e.itemId", "e.sourceDocumentId"))
      )
    )
    .leftJoin("trackedActivityOutput as ao", "ao.trackedActivityId", "a.id")
    .where("a.companyId", "=", args.companyId)
    .where("a.type", "=", "Consume")
    .where("e.status", "=", "Consumed")
    .where("i.itemTrackingType", "in", ["Serial", "Batch"])
    .$if(byMaterial, (qb) =>
      qb
        .where("a.sourceDocument", "=", "Job Material")
        .where("a.sourceDocumentId", "in", ids)
    )
    .$if(!byMaterial, (qb) => qb.where("ao.trackedEntityId", "in", ids))
    .distinctOn("e.id")
    .orderBy("e.id")
    .orderBy("a.createdAt", "desc")
    .select([
      "e.id",
      "e.readableId",
      "e.quantity",
      "i.id as itemId",
      "i.readableIdWithRevision",
      "i.name",
      "i.itemTrackingType",
      "a.sourceDocumentId as materialId",
      "ao.trackedEntityId as parentEntityId"
    ])
    .execute();
  return rows
    .map((row) => ({
      trackedEntityId: row.id,
      readableId: row.readableId ?? row.id,
      itemId: row.itemId,
      itemReadableId: row.readableIdWithRevision ?? "",
      name: row.name ?? "",
      trackingType: row.itemTrackingType as "Serial" | "Batch",
      quantity: Number(row.quantity),
      parentEntityId: row.parentEntityId ?? null,
      kitReadableId: null,
      materialId: row.materialId ?? ""
    }))
    .sort(
      (a, b) =>
        a.itemReadableId.localeCompare(b.itemReadableId) ||
        a.readableId.localeCompare(b.readableId, undefined, { numeric: true })
    );
}
