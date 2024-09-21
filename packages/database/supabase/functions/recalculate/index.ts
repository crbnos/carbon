import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { corsHeaders } from "../lib/headers.ts";
import { getJobMethodTree, JobMethodTreeItem } from "../lib/methods.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  type: z.enum(["jobRequirements"]),
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

    const client = getSupabaseServiceRole(req.headers.get("Authorization"));

    switch (type) {
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
          const updateQuantities = async (
            tree: JobMethodTreeItem,
            parentQuantity: number = 1
          ) => {
            const currentQuantity = tree.data.quantity * parentQuantity;

            // Update jobMaterial
            await trx
              .updateTable("jobMaterial")
              .set({ estimatedQuantity: currentQuantity })
              .where("id", "=", tree.id)
              .execute();

            // Update jobOperation
            await trx
              .updateTable("jobOperation")
              .set({ operationQuantity: currentQuantity })
              .where("jobMakeMethodId", "=", tree.data.jobMakeMethodId)
              .execute();

            // Recursively update children
            if (tree.children) {
              for (const child of tree.children) {
                await updateQuantities(child, currentQuantity);
              }
            }
          };

          await updateQuantities(jobMethodTree, job.data?.quantity);
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
