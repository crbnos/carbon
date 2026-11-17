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
  thumbnailPath: string | null;
  /** Per kit, for a part inside a kit; null for the material's own part. */
  perKit: number | null;
  /** How many the job plans to use on this material. */
  quantity: number;
};

/** A serial or batch used on the operation, to scrap by its own identity. */
export type ScrappableEntity = {
  trackedEntityId: string;
  /** The serial or batch number. */
  readableId: string;
  itemId: string;
  itemReadableId: string;
  name: string;
  thumbnailPath: string | null;
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
  jobStatus: string | null;
  jobMakeMethodId: string;
  locationId: string;
  /** Where the station's water spider works: the work center's location. */
  requestLocationId: string;
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
    .leftJoin("workCenter as wc", "wc.id", "o.workCenterId")
    .where("o.id", "=", args.jobOperationId)
    .where("o.companyId", "=", companyId)
    .select([
      "o.jobId",
      "o.jobMakeMethodId",
      "o.workCenterId",
      "j.locationId",
      "j.projectId",
      "j.status",
      "wc.locationId as workCenterLocationId"
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
      "jm.estimatedQuantity",
      "i.readableIdWithRevision",
      "i.name",
      "i.thumbnailPath",
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

  const kitMaterials = materials.filter(
    (m) => m.isKit && m.methodType === "Pull from Inventory"
  );
  const kitMaterialIds = new Set(kitMaterials.map((m) => m.id!));
  const kitItemIds = [...new Set(kitMaterials.map((m) => m.itemId!))];
  // Each kit's parts, from its active make method (else its latest draft),
  // and the serials and batches used: they do not depend on each other.
  const [kitParts, tracked] = await Promise.all([
    kitItemIds.length
      ? db
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
            "i.name",
            "i.thumbnailPath"
          ])
          .select((eb) => [
            "method.itemId as kitItemId",
            "mm.itemId",
            "i.readableIdWithRevision",
            "i.name",
            "i.thumbnailPath",
            eb.fn.sum<string>("mm.quantity").as("perKit")
          ])
          .orderBy("i.readableIdWithRevision")
          .execute()
      : [],
    consumedEntities(db, {
      companyId,
      materialIds: materials.map((m) => m.id!)
    })
  ]);
  const partsByKit = new Map<string, Omit<ScrappablePart, "quantity">[]>();
  for (const part of kitParts) {
    const list = partsByKit.get(part.kitItemId!) ?? [];
    list.push({
      itemId: part.itemId!,
      readableId: part.readableIdWithRevision ?? "",
      name: part.name ?? "",
      thumbnailPath: part.thumbnailPath ?? null,
      perKit: Number(part.perKit)
    });
    partsByKit.set(part.kitItemId!, list);
  }

  // The kit serials themselves are not offered: the parts inside them are.
  const kitEntities = tracked.filter((e) => kitMaterialIds.has(e.materialId));
  const inKits = await consumedEntities(db, {
    companyId,
    parentEntityIds: kitEntities.map((e) => e.trackedEntityId)
  });
  const kitByEntity = new Map(kitEntities.map((e) => [e.trackedEntityId, e]));
  const trackedByMaterial = new Map<string, ScrappableEntity[]>();
  const add = (materialId: string, entity: ScrappableEntity) => {
    const list = trackedByMaterial.get(materialId);
    if (list) list.push(entity);
    else trackedByMaterial.set(materialId, [entity]);
  };
  for (const e of tracked) {
    if (!kitMaterialIds.has(e.materialId)) add(e.materialId, e);
  }
  for (const e of inKits) {
    const kit = kitByEntity.get(e.parentEntityId!);
    if (kit) add(kit.materialId, { ...e, kitReadableId: kit.readableId });
  }

  return {
    jobId: operation.jobId,
    jobStatus: operation.status ?? null,
    jobMakeMethodId,
    locationId,
    requestLocationId: operation.workCenterLocationId ?? locationId,
    projectId: operation.projectId ?? null,
    workCenterId: operation.workCenterId ?? null,
    materials: materials
      .map((m) => {
        const isKit = kitMaterialIds.has(m.id!);
        const planned = Number(m.estimatedQuantity ?? 0);
        // A kit itself is not a part to scrap and replace: its parts are.
        const parts: ScrappablePart[] = isKit
          ? (partsByKit.get(m.itemId!) ?? []).map((part) => ({
              ...part,
              quantity: (part.perKit ?? 1) * planned
            }))
          : m.itemTrackingType === "Inventory"
            ? [
                {
                  itemId: m.itemId!,
                  readableId: m.readableIdWithRevision ?? "",
                  name: m.name ?? "",
                  thumbnailPath: m.thumbnailPath ?? null,
                  perKit: null,
                  quantity: planned
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
    // Only where it was last consumed: a part given back and used again
    // elsewhere belongs to that later use.
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("trackedActivityInput as later")
            .innerJoin(
              "trackedActivity as la",
              "la.id",
              "later.trackedActivityId"
            )
            .whereRef("later.trackedEntityId", "=", "e.id")
            .where("la.type", "=", "Consume")
            .whereRef("la.createdAt", ">", "a.createdAt")
            .select("later.trackedEntityId")
        )
      )
    )
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
      "i.thumbnailPath",
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
      thumbnailPath: row.thumbnailPath ?? null,
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

/** One part of the operation, however many of its materials use it. */
export type ScrappableGroup = {
  key: string;
  itemId: string;
  readableId: string;
  name: string;
  thumbnailPath: string | null;
  /** How many are on the operation: planned if untracked, else those used. */
  quantity: number;
  /** The kit it sits in, for a part inside a kit. */
  kit: { readableId: string; perKit: number | null } | null;
  /** The materials an untracked scrap can book against; empty if tracked. */
  materialIds: string[];
  tracked: (ScrappableEntity & { materialId: string })[];
};

/**
 * The operation's scrappable parts, one row per part: the same part on
 * several materials is listed once. A kit's parts stay with their kit.
 */
export function groupScrappableParts(
  materials: ScrappableMaterial[]
): ScrappableGroup[] {
  const groups = new Map<string, ScrappableGroup>();
  for (const material of materials) {
    const groupOf = (
      item: Pick<ScrappablePart, "itemId" | "name" | "thumbnailPath"> & {
        readableId: string;
        perKit: number | null;
      }
    ) => {
      const key = material.isKit
        ? `${material.id}:${item.itemId}`
        : item.itemId;
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          itemId: item.itemId,
          readableId: item.readableId,
          name: item.name,
          thumbnailPath: item.thumbnailPath,
          quantity: 0,
          kit: material.isKit
            ? { readableId: material.readableId, perKit: item.perKit }
            : null,
          materialIds: [],
          tracked: []
        };
        groups.set(key, group);
      }
      return group;
    };
    for (const part of material.parts) {
      const group = groupOf(part);
      group.quantity += part.quantity;
      group.materialIds.push(material.id);
    }
    for (const entity of material.tracked) {
      const group = groupOf({
        ...entity,
        readableId: entity.itemReadableId,
        perKit: null
      });
      group.quantity += entity.quantity;
      group.tracked.push({ ...entity, materialId: material.id });
    }
  }
  return [...groups.values()];
}
