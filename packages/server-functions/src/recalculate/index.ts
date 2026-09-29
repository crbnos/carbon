import type { KyselyDatabase } from "@carbon/database/client";
import {
  type ComputedJobQuantityNode,
  computeJobQuantities,
  flattenJobQuantityTree,
  getJobMethodTree,
  type JobMethodTreeItem
} from "@carbon/database/methods";
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
export const recalculate = defineServerFn({
  name: "recalculate",
  input: recalculateInput,
  permissions: { update: "production" },
  async run(ctx, { type, id }) {
    const { db, companyId, userId } = ctx;

    logger.info({ type, id, companyId, userId });

    const client = await ctx.supabase();

    switch (type) {
      case "jobMakeMethodRequirements": {
        const jobMakeMethodId = id;

        const [jobMakeMethod] = await Promise.all([
          client
            .from("jobMakeMethod")
            .select("*")
            .eq("id", jobMakeMethodId)
            .eq("companyId", companyId)
            .maybeSingle()
        ]);

        if (jobMakeMethod.error) {
          throw new Error(
            `Failed to get job makeMethod: ${jobMakeMethod.error.message}`
          );
        }
        // Service-role client: a make method outside companyId is a 404.
        if (!jobMakeMethod.data) {
          throw new NotFoundError("Job make method not found");
        }

        let parentQuantity = 1;
        if (jobMakeMethod.data.parentMaterialId) {
          const jobMaterial = await client
            .from("jobMaterial")
            .select("*")
            .eq("id", jobMakeMethod.data.parentMaterialId)
            .single();
          if (jobMaterial.data?.methodType !== "Make to Order") {
            return { success: true };
          }

          if (jobMaterial.error) {
            throw new Error(
              `Failed to get job material: ${jobMaterial.error.message}`
            );
          }

          if (!jobMaterial.data) {
            throw new NotFoundError(
              `Job material not found for id: ${jobMakeMethod.data.parentMaterialId}`
            );
          }

          if (jobMaterial.data.methodType !== "Make to Order") {
            logger.info(
              `Job material ${jobMakeMethod.data.parentMaterialId} is not a 'Make' type. Skipping recalculation.`
            );
            return { success: true };
          }

          parentQuantity =
            jobMaterial.data.estimatedQuantity ?? jobMaterial.data.quantity;
        } else {
          const job = await client
            .from("job")
            .select("*")
            .eq("id", jobMakeMethod.data.jobId)
            .single();
          if (job.error) {
            throw new Error(`Failed to get job: ${job.error.message}`);
          }
          // Use job.quantity as the root's target quantity (not productionQuantity)
          // The item's scrap percentage will be applied within updateJobQuantities
          parentQuantity = job.data.quantity ?? 1;
        }

        const jobMethodTrees = await getJobMethodTree(
          client,
          jobMakeMethod.data.id,
          jobMakeMethod.data.parentMaterialId
        );

        if (jobMethodTrees.error) {
          throw new Error(
            `Failed to get method tree: ${jobMethodTrees.error.message}`
          );
        }

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
        const [job, jobMakeMethod] = await Promise.all([
          client
            .from("job")
            .select("*")
            .eq("id", jobId)
            .eq("companyId", companyId)
            .maybeSingle(),
          client
            .from("jobMakeMethod")
            .select("*")
            .eq("jobId", jobId)
            .eq("companyId", companyId)
            .is("parentMaterialId", null)
            .single()
        ]);

        // Service-role client: a job outside companyId is a 404.
        if (!job.data) throw new NotFoundError("Job not found");

        if (jobMakeMethod.error) {
          throw new Error(
            `Failed to get job make method: ${jobMakeMethod.error.message}`
          );
        }

        const [jobMethodTrees] = await Promise.all([
          getJobMethodTree(client, jobMakeMethod.data.id)
        ]);

        if (jobMethodTrees.error) {
          throw new Error(
            `Failed to get method tree: ${jobMethodTrees.error.message}`
          );
        }

        const jobMethodTree = jobMethodTrees.data?.[0] as JobMethodTreeItem;
        if (!jobMethodTree) {
          throw new NotFoundError("Method tree not found");
        }

        await db.transaction().execute(async (trx) => {
          // Use job.quantity as the root's target quantity (not productionQuantity)
          // The item's scrap percentage will be applied within updateJobQuantities
          await updateJobQuantities(
            trx,
            jobMethodTree,
            job.data?.quantity ?? 1
          );
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
  // memory (lib/job-quantities-engine.ts, mirroring the mrp-engine pattern)
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
    await sql`
      UPDATE "jobMakeMethod" AS jmm
      SET "quantityPerParent" = v.qpp::numeric
      FROM (VALUES ${sql.join(
        makeNodes.map(
          (c) => sql`(${c.jobMaterialMakeMethodId}, ${c.quantityPerParent})`
        )
      )}) AS v(id, qpp)
      WHERE jmm.id = v.id
    `.execute(trx);

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
