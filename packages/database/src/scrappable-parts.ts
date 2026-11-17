// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What an operator can scrap from a job material and replace from the shelf:
// the material's own part, and, for a kit, the parts inside it. Untracked
// parts only: a tracked part is scrapped by its serial or batch.
// The MES dialog lists these and the scrapJobPart posting checks against them.

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
  jobId: string;
  locationId: string;
  projectId: string | null;
  parts: ScrappablePart[];
};

const isUntracked = (trackingType: string | null) =>
  trackingType === "Inventory";

export async function getScrappableParts(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; jobMaterialId: string }
): Promise<ScrappableMaterial | null> {
  const material = await db
    .selectFrom("jobMaterial as jm")
    .innerJoin("job as j", "j.id", "jm.jobId")
    .innerJoin("item as i", "i.id", "jm.itemId")
    .where("jm.id", "=", args.jobMaterialId)
    .where("jm.companyId", "=", args.companyId)
    .select(({ exists, selectFrom }) => [
      "jm.id",
      "jm.jobId",
      "jm.itemId",
      "jm.methodType",
      "j.locationId",
      "j.projectId",
      "i.readableIdWithRevision",
      "i.name",
      "i.itemTrackingType",
      // A kit is an item whose shelf slot at the location is a kit rack (line
      // feed lanes).
      exists(
        selectFrom("pickMethod as pm")
          .innerJoin("storageUnit as su", "su.id", "pm.defaultStorageUnitId")
          .whereRef("pm.itemId", "=", "jm.itemId")
          .whereRef("pm.locationId", "=", "j.locationId")
          .where("pm.companyId", "=", args.companyId)
          .where("su.kitRack", "=", true)
          .select("pm.itemId")
      ).as("isKit")
    ])
    .executeTakeFirst();
  if (!material?.jobId || !material.itemId || !material.locationId) return null;
  const isKit =
    material.methodType === "Pull from Inventory" && Boolean(material.isKit);

  // A kit's parts come from its active make method.
  const kitParts = isKit
    ? await db
        .selectFrom("methodMaterial as mm")
        .innerJoin("item as i", "i.id", "mm.itemId")
        .where("mm.makeMethodId", "=", ({ selectFrom }) =>
          selectFrom("makeMethod as m")
            .select("m.id")
            .where("m.itemId", "=", material.itemId!)
            .where("m.companyId", "=", args.companyId)
            .where("m.status", "<>", "Archived")
            .orderBy((eb) => eb("m.status", "=", "Active"), "desc")
            .orderBy("m.version", "desc")
            .limit(1)
        )
        .where("mm.methodType", "=", "Pull from Inventory")
        .where("i.itemTrackingType", "=", "Inventory")
        .groupBy(["mm.itemId", "i.readableIdWithRevision", "i.name"])
        .select((eb) => [
          "mm.itemId",
          "i.readableIdWithRevision",
          "i.name",
          eb.fn.sum<string>("mm.quantity").as("perKit")
        ])
        .orderBy("i.readableIdWithRevision")
        .execute()
    : [];

  // A kit itself is not a part to scrap and replace: its parts are.
  const own: ScrappablePart[] =
    !isKit &&
    material.methodType !== "Make to Order" &&
    isUntracked(material.itemTrackingType)
      ? [
          {
            itemId: material.itemId,
            readableId: material.readableIdWithRevision ?? "",
            name: material.name ?? "",
            perKit: null
          }
        ]
      : [];

  return {
    id: material.id!,
    jobId: material.jobId,
    locationId: material.locationId,
    projectId: material.projectId ?? null,
    parts: [
      ...own,
      ...kitParts.map((part) => ({
        itemId: part.itemId!,
        readableId: part.readableIdWithRevision ?? "",
        name: part.name ?? "",
        perKit: Number(part.perKit)
      }))
    ]
  };
}
