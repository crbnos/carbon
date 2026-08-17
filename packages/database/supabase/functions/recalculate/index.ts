import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { sql, Transaction } from "kysely";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import {
  computeJobQuantities,
  type ComputedJobQuantityNode,
  flattenJobQuantityTree,
} from "../lib/job-quantities-engine.ts";
import { getJobMethodTree, JobMethodTreeItem } from "../lib/methods.ts";
import { requirePermissions } from "../lib/supabase.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  type: z.enum(["jobMakeMethodRequirements", "jobRequirements"]),
  id: z.string(),
  companyId: z.string(),
  userId: z.string(),
});

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;
  const payload = await req.json();

  try {
    const { type, id, companyId, userId } = payloadValidator.parse(payload);

    console.log({
      function: "recalculate",
      type,
      id,
      companyId,
      userId,
    });

    const client = await requirePermissions(req, companyId, userId, { update: "production" });

    switch (type) {
      case "jobMakeMethodRequirements": {
        const jobMakeMethodId = id;

        const [jobMakeMethod] = await Promise.all([
          client
            .from("jobMakeMethod")
            .select("*")
            .eq("id", jobMakeMethodId)
            .single(),
        ]);

        if (jobMakeMethod.error) {
          throw new Error(
            `Failed to get job makeMethod: ${jobMakeMethod.error.message}`
          );
        }

        let parentQuantity = 1;
        if (jobMakeMethod.data.parentMaterialId) {
          const jobMaterial = await client
            .from("jobMaterial")
            .select("*")
            .eq("id", jobMakeMethod.data.parentMaterialId)
            .single();
          if (jobMaterial.data?.methodType !== "Make to Order") {
            return jsonResponse({ success: true });
          }

          if (jobMaterial.error) {
            throw new Error(
              `Failed to get job material: ${jobMaterial.error.message}`
            );
          }

          if (!jobMaterial.data) {
            throw new Error(
              `Job material not found for id: ${jobMakeMethod.data.parentMaterialId}`
            );
          }

          if (jobMaterial.data.methodType !== "Make to Order") {
            console.log(
              `Job material ${jobMakeMethod.data.parentMaterialId} is not a 'Make' type. Skipping recalculation.`
            );
            return jsonResponse({ success: true });
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
          throw new Error("Method tree not found");
        }

        await db.transaction().execute(async (trx) => {
          await updateJobQuantities(trx, jobMethodTree, parentQuantity);
        });

        break;
      }
      case "jobRequirements": {
        const jobId = id;
        const [job, jobMakeMethod] = await Promise.all([
          client.from("job").select("*").eq("id", jobId).single(),
          client
            .from("jobMakeMethod")
            .select("*")
            .eq("jobId", jobId)
            .is("parentMaterialId", null)
            .single(),
        ]);

        if (jobMakeMethod.error) {
          throw new Error(
            `Failed to get job make method: ${jobMakeMethod.error.message}`
          );
        }

        const [jobMethodTrees] = await Promise.all([
          getJobMethodTree(client, jobMakeMethod.data.id),
        ]);

        if (jobMethodTrees.error) {
          throw new Error(
            `Failed to get method tree: ${jobMethodTrees.error.message}`
          );
        }

        const jobMethodTree = jobMethodTrees.data?.[0] as JobMethodTreeItem;
        if (!jobMethodTree) {
          throw new Error("Method tree not found");
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

    return jsonResponse({
      success: true,
    });
  } catch (err) {
    return errorResponse(err, 500);
  }
});

const updateJobQuantities = async (
  trx: Transaction<DB>,
  tree: JobMethodTreeItem,
  parentEstimatedQuantity: number = 1
) => {
  // The tree is already fully loaded, so compute every node's quantities in
  // memory (lib/job-quantities-engine.ts, mirroring the mrp-engine pattern)
  // and write them set-based. The previous per-node recursion issued 2–4
  // statements per node on one transaction connection — O(tree) sequential
  // roundtrips, which on a large BOM exceeded the caller's invoke timeout.
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
    ),
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
    replenishmentScrapByItemId,
  });
  const allCycleNodeIds = new Set([...flattenCycles, ...cycleNodeIds]);
  if (allCycleNodeIds.size > 0) {
    // Corrupt tree data — the nodes were skipped rather than looped on.
    console.error(
      "recalculate: cyclic job method tree; skipped node ids:",
      [...allCycleNodeIds]
    );
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
                  : totalByMakeMethodId.get(m.id) ?? 1
              })`
          )
        )}) AS v(id, quantity)
        WHERE te.id = v.id
      `.execute(trx);
    }
  }
};
