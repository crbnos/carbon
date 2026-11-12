// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Inspection plans made from a model's PMI (the `pmi-inspection-plan` job), and
// their cleanup ahead of an item delete. Public through `./quality.ts`.
import type { Transaction } from "kysely";
import type { KyselyDatabase } from "./client.ts";

/** One characteristic of a plan made from a model's PMI (`pmiInspectionCharacteristics`). */
export type PmiPlanCharacteristic = {
  pmiItemId: string;
  label: string;
  description: string;
  nominalValue: string | null;
  tolerancePlus: string | null;
  toleranceMinus: string | null;
  unit: string;
};

/**
 * Makes the inspection plan for an item from its model's PMI: a plan that
 * holds the model and no PDF, with one Measurement feature per
 * characteristic. Runs in the caller's transaction. Returns the new plan's
 * id, or null when the item already has a plan for this model — the partial
 * unique index `inspectionDocument_part_model_key` decides, so two runs for
 * one model never make two plans and an edited plan is never rewritten.
 *
 * The drawing number follows the editor's rule for a plan created without
 * one: the item's `readableIdWithRevision`, with ` (1)`, ` (2)` … when taken.
 */
export async function createPmiInspectionPlan(
  trx: Transaction<KyselyDatabase>,
  args: {
    companyId: string;
    itemId: string;
    modelUploadId: string;
    characteristics: readonly PmiPlanCharacteristic[];
    createdBy: string;
  }
): Promise<string | null> {
  const { companyId, itemId, modelUploadId, characteristics, createdBy } = args;

  const item = await trx
    .selectFrom("item")
    .select(["readableIdWithRevision"])
    .where("id", "=", itemId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!item) return null;

  const base = item.readableIdWithRevision?.trim() || null;
  let name = base;
  if (base) {
    const taken = new Set(
      (
        await trx
          .selectFrom("inspectionDocument")
          .select(["name"])
          .where("companyId", "=", companyId)
          .where((eb) =>
            eb.or([eb("name", "=", base), eb("name", "like", `${base} (%)`)])
          )
          .execute()
      ).map((row) => row.name)
    );
    let suffix = 0;
    while (name && taken.has(name)) {
      suffix += 1;
      name = `${base} (${suffix})`;
    }
  }

  const plan = await trx
    .insertInto("inspectionDocument")
    .values({
      companyId,
      partId: itemId,
      modelUploadId,
      name,
      createdBy
    })
    .onConflict((oc) =>
      oc
        .columns(["companyId", "partId", "modelUploadId"])
        .where((eb) =>
          eb.and([
            eb("modelUploadId", "is not", null),
            eb("rootInspectionDocumentId", "is", null)
          ])
        )
        .doNothing()
    )
    .returning(["id"])
    .executeTakeFirst();
  if (!plan) return null;

  if (characteristics.length > 0) {
    await trx
      .insertInto("inspectionFeature")
      .values(
        characteristics.map((c) => ({
          companyId,
          inspectionDocumentId: plan.id,
          // A model plan has one "page": the save RPC defaults to 1 as well,
          // and the label trigger keeps labels unique across the plan.
          pageNumber: 1,
          label: c.label,
          description: c.description,
          nominalValue: c.nominalValue,
          tolerancePlus: c.tolerancePlus,
          toleranceMinus: c.toleranceMinus,
          unit: c.unit,
          type: "Measurement" as const,
          pmiItemId: c.pmiItemId,
          createdBy
        }))
      )
      .execute();
  }

  return plan.id;
}

/**
 * Deletes the plans made from the items' model PMI that no inspection used,
 * in the caller's transaction, ahead of an item delete. A plan made for the
 * item, not by a person, must not block the delete through
 * `inspectionDocument.partId`'s RESTRICT. A used one is inspection history and
 * still refuses it, as a plan made by hand does. Returns how many it deleted.
 */
export async function deleteUnusedPmiInspectionPlans(
  trx: Transaction<KyselyDatabase>,
  args: { companyId: string; itemIds: readonly string[] }
): Promise<number> {
  if (args.itemIds.length === 0) return 0;
  const result = await trx
    .deleteFrom("inspectionDocument")
    .where("companyId", "=", args.companyId)
    .where("partId", "in", [...args.itemIds])
    .where("modelUploadId", "is not", null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("inspection")
            .select("inspection.id")
            .whereRef(
              "inspection.inspectionDocumentId",
              "=",
              "inspectionDocument.id"
            )
        )
      )
    )
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
