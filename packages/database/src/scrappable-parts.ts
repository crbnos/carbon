// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What an operator can scrap at an operation and replace from the shelf: for
// each material of the operation's make method (and the parts of a kit made
// on the job), the material's own part, or, for a kit pulled from the rack,
// the parts inside it. Untracked parts only: a tracked part is scrapped by its
// serial or batch. Every MES view lists these and the scrapJobPart posting
// checks against them.

import type { Kysely, KyselyDatabase } from "./client.ts";

export type ScrappablePart = {
  itemId: string;
  readableId: string;
  name: string;
  /** Per kit, for a part inside a kit; null for the material's own part. */
  perKit: number | null;
};

export type ScrappableMaterial = {
  id: string;
  readableId: string;
  name: string;
  isKit: boolean;
  parts: ScrappablePart[];
};

export type ScrappableOperation = {
  jobId: string;
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
  if (!operation?.jobId || !operation.locationId) return null;
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

  return {
    jobId: operation.jobId,
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
          parts
        };
      })
      .filter((m) => m.parts.length > 0)
  };
}
