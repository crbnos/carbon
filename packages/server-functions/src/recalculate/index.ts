// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import {
  type ComputedJobQuantityNode,
  computeJobQuantities,
  flattenJobQuantityTree
} from "@carbon/database/job-quantities-engine";
import {
  getJobMethodTree,
  type JobMethodTreeItem
} from "@carbon/database/methods";
import { inOrder } from "@carbon/database/rows";
import { getLogger } from "@carbon/logger";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError } from "../errors";

const logger = getLogger("server-functions", "recalculate");

export const recalculateInput = z.object({
  type: z.enum(["jobMakeMethodRequirements", "jobRequirements"]),
  id: z.string()
});

/** Re-derives a job's (or one make method's) material and operation quantities. */
const recalculate = defineServerFn({
  name: "recalculate",
  input: recalculateInput,
  permissions: { update: "production" },
  async run(ctx, { type, id }) {
    const { db, companyId, userId } = ctx;

    logger.info({ type, id, companyId, userId });

    // Every read here goes over the direct connection: a PostgREST call costs
    // roughly ten times a statement, and this runs on every job save.
    switch (type) {
      case "jobMakeMethodRequirements": {
        const jobMakeMethodId = id;

        const jobMakeMethod = await db
          .selectFrom("jobMakeMethod")
          .select(["id", "jobId", "parentMaterialId"])
          .where("id", "=", jobMakeMethodId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();

        // A make method outside companyId is a 404.
        if (!jobMakeMethod) {
          throw new NotFoundError("Job make method not found");
        }

        let parentQuantity = 1;
        if (jobMakeMethod.parentMaterialId) {
          const jobMaterial = await db
            .selectFrom("jobMaterial")
            .select(["methodType", "estimatedQuantity", "quantity"])
            .where("id", "=", jobMakeMethod.parentMaterialId)
            .where("companyId", "=", companyId)
            .executeTakeFirst();

          if (jobMaterial?.methodType !== "Make to Order") {
            logger.info(
              `Job material ${jobMakeMethod.parentMaterialId} is not a 'Make' type. Skipping recalculation.`
            );
            return { success: true };
          }

          parentQuantity =
            jobMaterial.estimatedQuantity ?? jobMaterial.quantity;
        } else {
          const job = await db
            .selectFrom("job")
            .select(["quantity"])
            .where("id", "=", jobMakeMethod.jobId)
            .where("companyId", "=", companyId)
            .executeTakeFirst();
          if (!job) {
            throw new Error("Failed to get job");
          }
          // Use job.quantity as the root's target quantity (not productionQuantity)
          // The item's scrap percentage will be applied within updateJobQuantities
          parentQuantity = job.quantity ?? 1;
        }

        const jobMethodTrees = await getJobMethodTree(
          db,
          jobMakeMethod.id,
          jobMakeMethod.parentMaterialId
        );

        const jobMethodTree = jobMethodTrees.data?.[0] as JobMethodTreeItem;
        if (!jobMethodTree) {
          throw new NotFoundError("Method tree not found");
        }

        await db.transaction().execute(async (trx) => {
          await updateJobQuantities(trx, jobMethodTree, parentQuantity);
        });

        break;
      }
      case "jobRequirements": {
        const jobId = id;
        const [job, jobMakeMethods] = await inOrder([
          () =>
            db
              .selectFrom("job")
              .select(["quantity"])
              .where("id", "=", jobId)
              .where("companyId", "=", companyId)
              .executeTakeFirst(),
          () =>
            db
              .selectFrom("jobMakeMethod")
              .select(["id"])
              .where("jobId", "=", jobId)
              .where("companyId", "=", companyId)
              .where("parentMaterialId", "is", null)
              .execute()
        ]);

        // A job outside companyId is a 404.
        if (!job) throw new NotFoundError("Job not found");

        // Exactly one root make method, as `.single()` required before.
        const jobMakeMethod = jobMakeMethods[0];
        if (!jobMakeMethod || jobMakeMethods.length > 1) {
          throw new Error(
            `Failed to get job make method: found ${jobMakeMethods.length}`
          );
        }

        const jobMethodTrees = await getJobMethodTree(db, jobMakeMethod.id);

        const jobMethodTree = jobMethodTrees.data?.[0] as JobMethodTreeItem;
        if (!jobMethodTree) {
          throw new NotFoundError("Method tree not found");
        }

        await db.transaction().execute(async (trx) => {
          // Use job.quantity as the root's target quantity (not productionQuantity)
          // The item's scrap percentage will be applied within updateJobQuantities
          await updateJobQuantities(trx, jobMethodTree, job.quantity ?? 1);
        });

        break;
      }

      default:
        throw new Error(`Invalid type  ${type}`);
    }

    return { success: true };
  }
});

const updateJobQuantities = async (
  trx: Transaction<KyselyDatabase>,
  tree: JobMethodTreeItem,
  parentEstimatedQuantity: number = 1
) => {
  // The tree is already fully loaded, so compute every node's quantities in
  // memory (@carbon/database/job-quantities-engine, mirroring the mrp-engine pattern)
  // and write them set-based. The previous per-node recursion issued 2–4
  // statements per node on one transaction connection — O(tree) sequential
  // roundtrips, which on a large BOM exceeded the request timeout.
  const { nodes, cycleNodeIds: flattenCycles } = flattenJobQuantityTree(tree);

  const jobMaterials = await trx
    .selectFrom("jobMaterial")
    .select(["id", "itemScrapPercentage"])
    .where(
      "id",
      "in",
      nodes.map((n) => n.id)
    )
    .execute();
  const storedScrapById = new Map(
    jobMaterials.map((m) => [m.id, m.itemScrapPercentage])
  );

  const fallbackItemIds = [
    ...new Set(
      nodes
        .filter((n) => storedScrapById.get(n.id) == null)
        .map((n) => n.data.itemId)
    )
  ];
  const replenishmentScrapByItemId = new Map<string, number>();
  if (fallbackItemIds.length > 0) {
    const replenishments = await trx
      .selectFrom("itemReplenishment")
      .select(["itemId", "scrapPercentage"])
      .where("itemId", "in", fallbackItemIds)
      .execute();
    for (const row of replenishments) {
      replenishmentScrapByItemId.set(
        row.itemId,
        Number(row.scrapPercentage ?? 0)
      );
    }
  }

  const { computed, cycleNodeIds } = computeJobQuantities({
    tree,
    parentEstimatedQuantity,
    storedScrapById,
    replenishmentScrapByItemId
  });
  const allCycleNodeIds = new Set([...flattenCycles, ...cycleNodeIds]);
  if (allCycleNodeIds.size > 0) {
    // Corrupt tree data — the nodes were skipped rather than looped on.
    logger.error("recalculate: cyclic job method tree; skipped nodes", {
      skippedNodeIds: [...allCycleNodeIds]
    });
  }

  // jobMaterial scrap/estimated — one VALUES-join update for the whole tree
  const materialRows = computed.filter((c) => c.hasJobMaterial);
  if (materialRows.length > 0) {
    await sql`
      UPDATE "jobMaterial" AS m
      SET "scrapQuantity" = v.scrap::numeric,
          "estimatedQuantity" = v.estimated::numeric
      FROM (VALUES ${sql.join(
        materialRows.map(
          (c) => sql`(${c.id}, ${c.scrapQuantity}, ${c.estimatedQuantity})`
        )
      )}) AS v(id, scrap, estimated)
      WHERE m.id = v.id
    `.execute(trx);
  }

  const makeNodes = computed.filter(
    (c): c is ComputedJobQuantityNode & { jobMaterialMakeMethodId: string } =>
      c.jobMaterialMakeMethodId !== null
  );
  if (makeNodes.length > 0) {
    // Not the tree's root: the tree does not know how many of it its parent
    // needs, and writing its placeholder reset a sub-assembly to 1.
    const perParent = makeNodes.filter((c) => c.quantityPerParent !== null);
    if (perParent.length > 0) {
      await sql`
        UPDATE "jobMakeMethod" AS jmm
        SET "quantityPerParent" = v.qpp::numeric
        FROM (VALUES ${sql.join(
          perParent.map(
            (c) => sql`(${c.jobMaterialMakeMethodId}, ${c.quantityPerParent})`
          )
        )}) AS v(id, qpp)
        WHERE jmm.id = v.id
      `.execute(trx);
    }

    await sql`
      UPDATE "jobOperation" AS op
      SET "targetQuantity" = v.target::numeric,
          "operationQuantity" = v.total::numeric
      FROM (VALUES ${sql.join(
        makeNodes.map(
          (c) =>
            sql`(${c.jobMaterialMakeMethodId}, ${c.targetQuantity}, ${c.totalWithScrap})`
        )
      )}) AS v(id, target, total)
      WHERE op."jobMakeMethodId" = v.id
        AND op."reworkId" IS NULL
    `.execute(trx);

    const trackedMakeMethods = await trx
      .selectFrom("jobMakeMethod")
      .select(["id", "trackedEntityId", "requiresSerialTracking"])
      .where(
        "id",
        "in",
        makeNodes.map((c) => c.jobMaterialMakeMethodId)
      )
      .where("trackedEntityId", "is not", null)
      .execute();

    if (trackedMakeMethods.length > 0) {
      const totalByMakeMethodId = new Map(
        makeNodes.map((c) => [c.jobMaterialMakeMethodId, c.totalWithScrap])
      );
      await sql`
        UPDATE "trackedEntity" AS te
        SET "quantity" = v.quantity::numeric
        FROM (VALUES ${sql.join(
          trackedMakeMethods.map(
            (m) =>
              sql`(${m.trackedEntityId}, ${
                m.requiresSerialTracking
                  ? 1
                  : (totalByMakeMethodId.get(m.id) ?? 1)
              })`
          )
        )}) AS v(id, quantity)
        WHERE te.id = v.id
      `.execute(trx);
    }
  }
};

export default recalculate;
