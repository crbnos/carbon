import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { Transaction } from "kysely";
import { corsHeaders } from "../lib/headers.ts";
import { getJobMethodTree, JobMethodTreeItem } from "../lib/methods.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  type: z.enum(["jobMakeMethodRequirements", "jobRequirements"]),
  id: z.string(),
  companyId: z.string(),
  userId: z.string(),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
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

    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

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
          if (jobMaterial.data?.methodType !== "Make") {
            return new Response(JSON.stringify({ success: true }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 200,
            });
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

          if (jobMaterial.data.methodType !== "Make") {
            console.log(
              `Job material ${jobMakeMethod.data.parentMaterialId} is not a 'Make' type. Skipping recalculation.`
            );
            return new Response(JSON.stringify({ success: true }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 200,
            });
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
          parentQuantity = job.data.productionQuantity ?? 1;
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

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

const updateJobQuantities = async (
  trx: Transaction<DB>,
  tree: JobMethodTreeItem,
  parentEstimatedQuantity: number = 1
) => {
  // Target quantity for this node:
  // - For root: targetQuantity = parentEstimatedQuantity (which is productionQuantity from job)
  // - For children: targetQuantity = parentEstimatedQuantity * quantity (quantity per parent)
  const targetQuantity = tree.data.isRoot
    ? parentEstimatedQuantity
    : tree.data.quantity * parentEstimatedQuantity;

  // Get scrap percentage from jobMaterial (stored at job creation time)
  // Fall back to itemReplenishment if not stored
  let scrapPercentage = 0;
  if (tree.data.methodType === "Make") {
    const jobMaterial = await trx
      .selectFrom("jobMaterial")
      .select("itemScrapPercentage")
      .where("id", "=", tree.id)
      .executeTakeFirst();

    if (
      jobMaterial?.itemScrapPercentage != null &&
      jobMaterial.itemScrapPercentage > 0
    ) {
      scrapPercentage = Number(jobMaterial.itemScrapPercentage);
    } else {
      // Fall back to itemReplenishment
      const itemReplenishment = await trx
        .selectFrom("itemReplenishment")
        .select("scrapPercentage")
        .where("itemId", "=", tree.data.itemId)
        .executeTakeFirst();
      scrapPercentage = Number(itemReplenishment?.scrapPercentage ?? 0);
    }
  }

  // Calculate scrap and estimated quantities
  // scrapQuantity = portion attributable to scrap (only for Make parts)
  // totalWithScrap = target + scrap allowance (what we need to make/procure)
  // estimatedQuantity: For Make = good quantity (without scrap), For Buy/Pick = total
  const scrapQuantity =
    tree.data.methodType === "Make" ? targetQuantity * scrapPercentage : 0;
  const totalWithScrap = Math.ceil(targetQuantity + scrapQuantity);
  // For Make: estimatedQuantity is good quantity (without scrap)
  // For Buy/Pick: estimatedQuantity = total (but scrap is 0, so same as target)
  const estimatedQuantity =
    tree.data.methodType === "Make" ? targetQuantity : totalWithScrap;

  // Update jobMaterial with scrap and estimated quantities
  await trx
    .updateTable("jobMaterial")
    .set({
      scrapQuantity: scrapQuantity,
      estimatedQuantity: estimatedQuantity,
    })
    .where("id", "=", tree.id)
    .execute();

  if (tree.data.jobMaterialMakeMethodId) {
    const [jobMakeMethod] = await Promise.all([
      trx
        .selectFrom("jobMakeMethod")
        .select(["trackedEntityId", "requiresSerialTracking"])
        .where("id", "=", tree.data.jobMaterialMakeMethodId)
        .executeTakeFirst(),
      trx
        .updateTable("jobMakeMethod")
        .set({ quantityPerParent: tree.data.quantity })
        .where("id", "=", tree.data.jobMaterialMakeMethodId)
        .execute(),
      trx
        .updateTable("jobOperation")
        .set({
          targetQuantity: targetQuantity,
          operationQuantity: totalWithScrap,
        })
        .where("jobMakeMethodId", "=", tree.data.jobMaterialMakeMethodId)
        .execute(),
    ]);

    if (jobMakeMethod?.trackedEntityId) {
      await trx
        .updateTable("trackedEntity")
        .set({
          quantity: jobMakeMethod.requiresSerialTracking ? 1 : totalWithScrap,
        })
        .where("id", "=", jobMakeMethod.trackedEntityId)
        .execute();
    }
  }

  // Recursively update children with this node's total (estimated + scrap)
  // Children use the total for their target calculation to properly cascade scrap
  if (tree.children) {
    for (const child of tree.children) {
      await updateJobQuantities(trx, child, totalWithScrap);
    }
  }
};
