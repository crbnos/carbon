import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import z from "npm:zod@^3.24.1";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { getReadableIdWithRevision } from "../lib/utils.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const onShapeDataValidator = z.object({
  index: z.string(),
  id: z.string().optional(),
  readableId: z.string().optional(),
  revision: z.string().optional(),
  name: z.string(),
  quantity: z.number(),
  replenishmentSystem: z.enum(["Make", "Buy", "Buy and Make"]),
  defaultMethodType: z.enum(["Make", "Buy", "Pick"]),
  data: z.record(z.string(), z.any()),
});

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("onshape"),
    makeMethodId: z.string(),
    data: onShapeDataValidator.array(),
    companyId: z.string(),
    userId: z.string(),
  }),
]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  const { type, companyId, userId } = payloadValidator.parse(payload);

  switch (type) {
    case "onshape": {
      const { makeMethodId, data } = payload;

      console.log({
        function: "sync",
        type,
        makeMethodId,
        data,
        companyId,
        userId,
      });

      const client = await getSupabaseServiceRole(
        req.headers.get("Authorization"),
        req.headers.get("carbon-key") ?? ""
      );

      const existingItemIds = new Set(
        data.map((item: { id?: string }) => item.id).filter(Boolean)
      );

      const [existingMakeMethods, existingItems] = await Promise.all([
        client
          .from("makeMethod")
          .select("id, itemId")
          .eq("companyId", companyId)
          .in("itemId", Array.from(existingItemIds)),
        client
          .from("item")
          .select(
            "id, readableId, readableIdWithRevision, unitOfMeasureCode, type, revision"
          )
          .eq("companyId", companyId)
          .in("id", Array.from(existingItemIds)),
      ]);

      const existingMakeMethodIdsByItemId = new Map(
        existingMakeMethods.data?.map((makeMethod) => [
          makeMethod.itemId,
          makeMethod.id,
        ]) ?? []
      );

      const existingItemsByItemId = new Map(
        existingItems.data?.map((item) => [item.id, item]) ?? []
      );

      try {
        interface TreeNode {
          data: z.infer<typeof onShapeDataValidator>;
          children: TreeNode[];
          level: number;
        }

        // Sort the data by index to ensure parent nodes come before children
        const sortedData = [...data].sort((a, b) => {
          const aIndices = a.index.toString().split(".");
          const bIndices = b.index.toString().split(".");

          // Compare each level of the index
          for (let i = 0; i < Math.min(aIndices.length, bIndices.length); i++) {
            const aVal = parseInt(aIndices[i]);
            const bVal = parseInt(bIndices[i]);
            if (aVal !== bVal) {
              return aVal - bVal;
            }
          }

          // If one index is a prefix of the other, the shorter one comes first
          return aIndices.length - bIndices.length;
        });

        // Build the tree
        const buildTree = (
          d: z.infer<typeof onShapeDataValidator>[]
        ): TreeNode[] => {
          const result: TreeNode[] = [];
          const nodeMap = new Map<string, TreeNode>();

          d.forEach((item) => {
            const indexStr = item.index.toString();
            const node: TreeNode = {
              data: item,
              children: [],
              level: indexStr.split(".").length,
            };

            nodeMap.set(indexStr, node);

            // Find parent node
            const lastDotIndex = indexStr.lastIndexOf(".");
            if (lastDotIndex === -1) {
              // This is a root node
              result.push(node);
            } else {
              // This is a child node
              const parentIndex = indexStr.substring(0, lastDotIndex);
              const parentNode = nodeMap.get(parentIndex);
              if (parentNode) {
                parentNode.children.push(node);
              }
            }
          });

          return result;
        };

        const tree = buildTree(sortedData);

        await db.transaction().execute(async (trx) => {
          await trx
            .deleteFrom("methodMaterial")
            .where("makeMethodId", "=", makeMethodId)
            .execute();

          // Track newly created items and make methods to avoid duplicate inserts
          const newlyCreatedItemsByPartId = new Map<string, string>();
          const newlyCreatedMakeMethodsByItemId = new Map<string, string>();

          async function traverseTree(
            node: TreeNode,
            parentMakeMethodId: string,
            index: number
          ) {
            const { data, children } = node;
            const {
              id,
              readableId,
              revision,
              name,
              quantity,
              replenishmentSystem,
              defaultMethodType,
            } = data;

            const partId = readableId || name;
            if (!partId) return;

            const isMade = children.length > 0;
            let itemId = id;

            if (itemId) {
              // Update existing item with Onshape data
              await trx
                .updateTable("item")
                .set({
                  externalId: {
                    onshapeData: data.data,
                  },
                  updatedBy: userId,
                  updatedAt: new Date().toISOString(),
                })
                .where("id", "=", itemId)
                .execute();
            } else {
              // Check if we've already created this part in this transaction
              itemId = newlyCreatedItemsByPartId.get(partId);

              if (!itemId) {
                // Create new item and part
                const item = await trx
                  .insertInto("item")
                  .values({
                    readableId: partId,
                    revision: revision ?? "0",
                    name,
                    type: "Part",
                    unitOfMeasureCode: "EA",
                    itemTrackingType: "Inventory",
                    replenishmentSystem,
                    defaultMethodType,
                    companyId,
                    externalId: {
                      onshapeData: data.data,
                    },
                    createdBy: userId,
                  })
                  .returning(["id"])
                  .executeTakeFirst();

                itemId = item?.id;

                await trx
                  .insertInto("part")
                  .values({
                    id: partId,
                    companyId,
                    createdBy: userId,
                  })
                  .onConflict((oc) =>
                    oc.columns(["id", "companyId"]).doUpdateSet({
                      updatedBy: userId,
                      updatedAt: new Date().toISOString(),
                    })
                  )
                  .execute();

                // Store the newly created item to avoid duplicate inserts
                if (itemId) {
                  newlyCreatedItemsByPartId.set(partId, itemId);
                  // Also update our existing items map for later reference
                  existingItemsByItemId.set(itemId, {
                    id: itemId,
                    readableId: partId,
                    readableIdWithRevision: getReadableIdWithRevision(
                      partId,
                      revision
                    ),
                    revision: revision ?? "0",
                    unitOfMeasureCode: "EA",
                    type: "Part",
                  });
                }
              }
            }

            if (!itemId) throw new Error("Failed to create item");

            let materialMakeMethodId =
              existingMakeMethodIdsByItemId.get(itemId) ||
              newlyCreatedMakeMethodsByItemId.get(itemId);

            if (
              (defaultMethodType === "Make" || isMade) &&
              !materialMakeMethodId
            ) {
              const makeMethod = await trx
                .selectFrom("makeMethod")
                .select(["id"])
                .where("itemId", "=", itemId)
                .executeTakeFirst();

              materialMakeMethodId = makeMethod?.id;

              if (
                !materialMakeMethodId &&
                (defaultMethodType === "Make" || isMade)
              ) {
                // Create a new make method if needed
                const newMakeMethod = await trx
                  .insertInto("makeMethod")
                  .values({
                    itemId,
                    companyId,
                    createdBy: userId,
                  })
                  .returning(["id"])
                  .executeTakeFirst();

                materialMakeMethodId = newMakeMethod?.id;

                if (materialMakeMethodId) {
                  newlyCreatedMakeMethodsByItemId.set(
                    itemId,
                    materialMakeMethodId
                  );
                  existingMakeMethodIdsByItemId.set(
                    itemId,
                    materialMakeMethodId
                  );
                }
              }
            }

            await trx
              .insertInto("methodMaterial")
              .values({
                itemId,
                quantity: quantity ?? 1,
                makeMethodId: parentMakeMethodId,
                materialMakeMethodId,
                methodType: defaultMethodType,
                order: index,
                itemType: existingItemsByItemId.get(itemId)?.type ?? "Part",
                unitOfMeasureCode:
                  existingItemsByItemId.get(itemId)?.unitOfMeasureCode ?? "EA",
                companyId,
                createdBy: userId,
              })
              .execute();

            if (materialMakeMethodId) {
              await trx
                .deleteFrom("methodMaterial")
                .where("makeMethodId", "=", materialMakeMethodId)
                .execute();

              for await (const child of children) {
                const childIndex = children.indexOf(child);
                await traverseTree(child, materialMakeMethodId, childIndex);
              }
            }
          }

          let index = 0;
          for await (const node of tree) {
            await traverseTree(node, makeMethodId, index);
            index++;
          }
        });
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
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
    }
  }
});
