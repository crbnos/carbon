import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";

import type {
  PostgrestError,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.33.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import type { Database } from "../lib/types.ts";

import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  type: z.enum([
    "itemToQuoteMakeMethod",
    "itemToQuoteLine",
    "quoteMakeMethodToItem",
    "quoteLineToItem",
  ]),
  sourceId: z.string(),
  targetId: z.string(),
  companyId: z.string(),
  userId: z.string(),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  try {
    const { type, sourceId, targetId, companyId, userId } =
      payloadValidator.parse(payload);

    console.log({
      function: "get-method",
      type,
      sourceId,
      targetId,
      companyId,
      userId,
    });

    const client = getSupabaseServiceRole(req.headers.get("Authorization"));

    switch (type) {
      case "itemToQuoteLine": {
        const [quoteId, quoteLineId] = (targetId as string).split(":");
        if (!quoteId || !quoteLineId) {
          throw new Error("Invalid targetId");
        }
        const itemId = sourceId;

        const [makeMethod, quoteMakeMethod, workCenters] = await Promise.all([
          client.from("makeMethod").select("*").eq("itemId", itemId).single(),
          client
            .from("quoteMakeMethod")
            .select("*")
            .eq("quoteLineId", quoteLineId)
            .is("parentMaterialId", null)
            .single(),
          client.from("workCenters").select("*").eq("companyId", companyId),
        ]);

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (quoteMakeMethod.error) {
          throw new Error("Failed to get quote make method");
        }

        if (workCenters.error) {
          throw new Error("Failed to get related work centers");
        }

        const [methodTrees] = await Promise.all([
          getMethodTree(client, makeMethod.data.id),
        ]);

        if (methodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const methodTree = methodTrees.data?.[0] as MethodTreeItem;
        if (!methodTree) throw new Error("Method tree not found");

        const getRates = getRatesFromWorkCenters(workCenters?.data);

        await db.transaction().execute(async (trx) => {
          // Delete existing quoteMakeMethod, quoteMakeMethodOperation, quoteMakeMethodMaterial
          await Promise.all([
            trx
              .deleteFrom("quoteMakeMethod")
              .where((eb) =>
                eb.and([
                  eb("quoteLineId", "=", quoteLineId),
                  eb("parentMaterialId", "is not", null),
                ])
              )
              .execute(),
            trx
              .deleteFrom("quoteMaterial")
              .where("quoteLineId", "=", quoteLineId)
              .execute(),
            trx
              .deleteFrom("quoteOperation")
              .where("quoteLineId", "=", quoteLineId)
              .execute(),
          ]);

          // traverse method tree and create:
          // - quoteMakeMethod
          // - quoteMakeMethodOperation
          // - quoteMakeMethodMaterial
          async function traverseMethod(
            node: MethodTreeItem,
            parentQuoteMakeMethodId: string | null
          ) {
            const relatedOperations = await client
              .from("methodOperation")
              .select("*")
              .eq("makeMethodId", node.data.materialMakeMethodId);

            const quoteOperations =
              relatedOperations?.data?.map((op) => ({
                quoteId,
                quoteLineId,
                quoteMakeMethodId: parentQuoteMakeMethodId!,
                processId: op.processId,
                workCenterId: op.workCenterId,
                description: op.description,
                setupTime: op.setupTime,
                setupUnit: op.setupUnit,
                laborTime: op.laborTime,
                laborUnit: op.laborUnit,
                machineTime: op.machineTime,
                machineUnit: op.machineUnit,
                ...getRates(op.processId, op.workCenterId),
                order: op.order,
                operationOrder: op.operationOrder,
                companyId,
                createdBy: userId,
                customFields: {},
              })) ?? [];

            let methodOperationsToQuoteOperations: Record<string, string> = {};
            if (quoteOperations?.length > 0) {
              const operationIds = await trx
                .insertInto("quoteOperation")
                .values(quoteOperations)
                .returning(["id"])
                .execute();

              methodOperationsToQuoteOperations =
                relatedOperations.data?.reduce<Record<string, string>>(
                  (acc, op, index) => {
                    if (operationIds[index].id) {
                      acc[op.id!] = operationIds[index].id!;
                    }
                    return acc;
                  },
                  {}
                ) ?? {};
            }

            const mapMethodMaterialToQuoteMaterial = (
              child: MethodTreeItem
            ) => ({
              quoteId,
              quoteLineId,
              quoteMakeMethodId: parentQuoteMakeMethodId!,
              quoteOperationId:
                methodOperationsToQuoteOperations[child.data.operationId],
              itemId: child.data.itemId,
              itemReadableId: child.data.itemReadableId,
              itemType: child.data.itemType,
              methodType: child.data.methodType,
              order: child.data.order,
              description: child.data.description,
              quantity: child.data.quantity,
              unitOfMeasureCode: child.data.unitOfMeasureCode,
              unitCost: child.data.unitCost,
              companyId,
              createdBy: userId,
              customFields: {},
            });

            const madeChildren = node.children.filter(
              (child) => child.data.methodType === "Make"
            );
            const unmadeChildren = node.children.filter(
              (child) => child.data.methodType !== "Make"
            );

            const madeMaterials = madeChildren.map(
              mapMethodMaterialToQuoteMaterial
            );
            const pickedOrBoughtMaterials = unmadeChildren.map(
              mapMethodMaterialToQuoteMaterial
            );
            if (madeMaterials.length > 0) {
              const madeMaterialIds = await trx
                .insertInto("quoteMaterial")
                .values(madeMaterials)
                .returning(["id"])
                .execute();

              const quoteMakeMethods = await trx
                .selectFrom("quoteMakeMethod")
                .select(["id"])
                .where(
                  "parentMaterialId",
                  "in",
                  madeMaterialIds.map((m) => m.id)
                )
                .execute();

              for (const [index, child] of madeChildren.entries()) {
                const makeMethodId = quoteMakeMethods[index].id ?? null;
                // prevent an infinite loop
                if (child.data.itemId !== itemId) {
                  await traverseMethod(child, makeMethodId);
                }
              }
            }

            if (pickedOrBoughtMaterials.length > 0) {
              await trx
                .insertInto("quoteMaterial")
                .values(pickedOrBoughtMaterials)
                .execute();
            }
          }

          await traverseMethod(methodTree, quoteMakeMethod.data.id);
        });

        break;
      }
      case "itemToQuoteMakeMethod": {
        const quoteMakeMethodId = targetId;

        if (!quoteMakeMethodId) {
          throw new Error("Invalid targetId");
        }
        const itemId = sourceId;

        const [makeMethod, quoteMakeMethod, workCenters] = await Promise.all([
          client.from("makeMethod").select("*").eq("itemId", itemId).single(),
          client
            .from("quoteMakeMethod")
            .select("*")
            .eq("id", quoteMakeMethodId)
            .single(),
          client.from("workCenters").select("*").eq("companyId", companyId),
        ]);

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (quoteMakeMethod.error || !quoteMakeMethod.data) {
          throw new Error("Failed to get quote make method");
        }

        const [methodTrees] = await Promise.all([
          getMethodTree(client, makeMethod.data.id),
        ]);

        if (methodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const methodTree = methodTrees.data?.[0] as MethodTreeItem;
        if (!methodTree) throw new Error("Method tree not found");

        const getRates = getRatesFromWorkCenters(workCenters?.data);

        await db.transaction().execute(async (trx) => {
          // Delete existing quoteMakeMethodOperation, quoteMakeMethodMaterial
          await Promise.all([
            trx
              .deleteFrom("quoteMaterial")
              .where("quoteMakeMethodId", "=", quoteMakeMethodId)
              .execute(),
            trx
              .deleteFrom("quoteOperation")
              .where("quoteMakeMethodId", "=", quoteMakeMethodId)
              .execute(),
          ]);

          // traverse method tree and create:
          // - quoteMakeMethod
          // - quoteMakeMethodOperation
          // - quoteMakeMethodMaterial
          async function traverseMethod(
            node: MethodTreeItem,
            parentQuoteMakeMethodId: string | null
          ) {
            const relatedOperations = await client
              .from("methodOperation")
              .select("*")
              .eq("makeMethodId", node.data.materialMakeMethodId);

            const quoteOperations =
              relatedOperations?.data?.map((op) => ({
                quoteId: quoteMakeMethod.data?.quoteId!,
                quoteLineId: quoteMakeMethod.data?.quoteLineId!,
                quoteMakeMethodId: parentQuoteMakeMethodId!,
                processId: op.processId,
                workCenterId: op.workCenterId,
                description: op.description,
                setupTime: op.setupTime,
                setupUnit: op.setupUnit,
                laborTime: op.laborTime,
                laborUnit: op.laborUnit,
                machineTime: op.machineTime,
                machineUnit: op.machineUnit,
                ...getRates(op.processId, op.workCenterId),

                order: op.order,
                operationOrder: op.operationOrder,
                companyId,
                createdBy: userId,
                customFields: {},
              })) ?? [];

            let methodOperationsToQuoteOperations: Record<string, string> = {};
            if (quoteOperations?.length > 0) {
              const operationIds = await trx
                .insertInto("quoteOperation")
                .values(quoteOperations)
                .returning(["id"])
                .execute();

              methodOperationsToQuoteOperations =
                relatedOperations.data?.reduce<Record<string, string>>(
                  (acc, op, index) => {
                    if (operationIds[index].id) {
                      acc[op.id!] = operationIds[index].id!;
                    }
                    return acc;
                  },
                  {}
                ) ?? {};
            }

            const mapMethodMaterialToQuoteMaterial = (
              child: MethodTreeItem
            ) => ({
              quoteId: quoteMakeMethod.data?.quoteId!,
              quoteLineId: quoteMakeMethod.data?.quoteLineId!,
              quoteMakeMethodId: parentQuoteMakeMethodId!,
              quoteOperationId:
                methodOperationsToQuoteOperations[child.data.operationId],
              itemId: child.data.itemId,
              itemReadableId: child.data.itemReadableId,
              itemType: child.data.itemType,
              methodType: child.data.methodType,
              order: child.data.order,
              description: child.data.description,
              quantity: child.data.quantity,
              unitOfMeasureCode: child.data.unitOfMeasureCode,
              unitCost: child.data.unitCost,
              companyId,
              createdBy: userId,
              customFields: {},
            });

            const madeChildren = node.children.filter(
              (child) => child.data.methodType === "Make"
            );
            const unmadeChildren = node.children.filter(
              (child) => child.data.methodType !== "Make"
            );

            const madeMaterials = madeChildren.map(
              mapMethodMaterialToQuoteMaterial
            );
            const pickedOrBoughtMaterials = unmadeChildren.map(
              mapMethodMaterialToQuoteMaterial
            );
            if (madeMaterials.length > 0) {
              const madeMaterialIds = await trx
                .insertInto("quoteMaterial")
                .values(madeMaterials)
                .returning(["id"])
                .execute();

              const quoteMakeMethods = await trx
                .selectFrom("quoteMakeMethod")
                .select(["id"])
                .where(
                  "parentMaterialId",
                  "in",
                  madeMaterialIds.map((m) => m.id)
                )
                .execute();

              for (const [index, child] of madeChildren.entries()) {
                const makeMethodId = quoteMakeMethods[index].id ?? null;
                // prevent an infinite loop
                if (child.data.itemId !== itemId) {
                  await traverseMethod(child, makeMethodId);
                }
              }
            }

            if (pickedOrBoughtMaterials.length > 0) {
              await trx
                .insertInto("quoteMaterial")
                .values(pickedOrBoughtMaterials)
                .execute();
            }
          }

          await traverseMethod(methodTree, quoteMakeMethod.data.id);
        });
        break;
      }
      case "quoteLineToItem": {
        const [quoteId, quoteLineId] = (sourceId as string).split(":");
        if (!quoteId || !quoteLineId) {
          throw new Error("Invalid targetId");
        }
        const itemId = targetId;

        const [makeMethod, quoteMakeMethod, quoteOperations] =
          await Promise.all([
            client.from("makeMethod").select("*").eq("itemId", itemId).single(),
            client
              .from("quoteMakeMethod")
              .select("*")
              .eq("quoteLineId", quoteLineId)
              .is("parentMaterialId", null)
              .single(),
            client
              .from("quoteOperationsWithMakeMethods")
              .select("*")
              .eq("quoteLineId", quoteLineId),
          ]);

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (quoteMakeMethod.error) {
          throw new Error("Failed to get quote make method");
        }

        if (quoteOperations.error) {
          throw new Error("Failed to get quote operations");
        }

        const [quoteMethodTrees] = await Promise.all([
          getQuoteMethodTree(client, quoteMakeMethod.data.id),
        ]);

        if (quoteMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const quoteMethodTree = quoteMethodTrees
          .data?.[0] as QuoteMethodTreeItem;
        if (!quoteMethodTree) throw new Error("Method tree not found");

        const madeItemIds: string[] = [];

        traverseQuoteMethod(quoteMethodTree, (node: QuoteMethodTreeItem) => {
          if (node.data.itemId && node.data.methodType === "Make") {
            madeItemIds.push(node.data.itemId);
          }
        });

        const makeMethods = await client
          .from("makeMethod")
          .select("*")
          .in("itemId", madeItemIds);
        if (makeMethods.error) {
          throw new Error("Failed to get make methods");
        }

        const makeMethodByItemId: Record<string, string> = {};
        makeMethods.data?.forEach((m) => {
          makeMethodByItemId[m.itemId] = m.id;
        });

        await db.transaction().execute(async (trx) => {
          let makeMethodsToDelete: string[] = [];
          const materialInserts: Database["public"]["Tables"]["methodMaterial"]["Insert"][] =
            [];
          const operationInserts: Database["public"]["Tables"]["methodOperation"]["Insert"][] =
            [];

          traverseQuoteMethod(quoteMethodTree, (node: QuoteMethodTreeItem) => {
            if (node.data.itemId && node.data.methodType === "Make") {
              makeMethodsToDelete.push(makeMethodByItemId[node.data.itemId]);
            }

            node.children.forEach((child) => {
              materialInserts.push({
                makeMethodId: makeMethodByItemId[node.data.itemId],
                materialMakeMethodId: makeMethodByItemId[child.data.itemId],
                itemId: child.data.itemId,
                itemReadableId: child.data.itemReadableId,
                itemType: child.data.itemType,
                methodType: child.data.methodType,
                order: child.data.order,
                quantity: child.data.quantity,
                unitOfMeasureCode: child.data.unitOfMeasureCode,
                companyId,
                createdBy: userId,
                customFields: {},
              });
            });
          });

          if (makeMethodsToDelete.length > 0) {
            makeMethodsToDelete = makeMethodsToDelete.map((mm) =>
              mm === makeMethodByItemId[quoteMakeMethod.data.itemId]
                ? makeMethod.data.id
                : mm
            );
            await Promise.all([
              trx
                .deleteFrom("methodMaterial")
                .where("makeMethodId", "in", makeMethodsToDelete)
                .execute(),
              trx
                .deleteFrom("methodOperation")
                .where("makeMethodId", "in", makeMethodsToDelete)
                .execute(),
            ]);
          }

          if (materialInserts.length > 0) {
            await trx
              .insertInto("methodMaterial")
              .values(
                materialInserts.map((insert) => ({
                  ...insert,
                  makeMethodId:
                    insert.makeMethodId ===
                    makeMethodByItemId[quoteMakeMethod.data.itemId]
                      ? makeMethod.data.id
                      : insert.makeMethodId,
                  itemId:
                    insert.itemId === quoteMakeMethod.data.itemId
                      ? itemId
                      : insert.itemId,
                }))
              )
              .execute();
          }

          quoteOperations.data?.forEach((op) => {
            operationInserts.push({
              makeMethodId: op.makeMethodId!,
              processId: op.processId!,
              workCenterId: op.workCenterId,
              description: op.description ?? "",
              setupTime: op.setupTime ?? 0,
              setupUnit: op.setupUnit ?? "Total Minutes",
              laborTime: op.laborTime ?? 0,
              laborUnit: op.laborUnit ?? "Minutes/Piece",
              machineTime: op.machineTime ?? 0,
              machineUnit: op.machineUnit ?? "Minutes/Piece",
              order: op.order ?? 1,
              operationOrder: op.operationOrder ?? "After Previous",
              companyId,
              createdBy: userId,
              customFields: {},
            });
          });

          if (operationInserts.length > 0) {
            await trx
              .insertInto("methodOperation")
              .values(
                operationInserts.map((insert) => ({
                  ...insert,
                  makeMethodId:
                    insert.makeMethodId ===
                    makeMethodByItemId[quoteMakeMethod.data.itemId]
                      ? makeMethod.data.id
                      : insert.makeMethodId,
                }))
              )
              .execute();
          }
        });

        break;
      }
      case "quoteMakeMethodToItem": {
        const quoteMakeMethodId = sourceId;
        const itemId = targetId;

        const [makeMethod, quoteMakeMethod] = await Promise.all([
          client.from("makeMethod").select("*").eq("itemId", itemId).single(),
          client
            .from("quoteMakeMethod")
            .select("*")
            .eq("id", quoteMakeMethodId)
            .single(),
        ]);

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (quoteMakeMethod.error) {
          throw new Error("Failed to get quote make method");
        }

        const [quoteOperations, quoteParentMakeMethod] = await Promise.all([
          client
            .from("quoteOperationsWithMakeMethods")
            .select("*")
            .eq("quoteLineId", quoteMakeMethod.data.quoteLineId),
          client
            .from("quoteMakeMethod")
            .select("*")
            .eq("quoteLineId", quoteMakeMethod.data.quoteLineId)
            .is("parentMaterialId", null)
            .single(),
        ]);

        if (quoteOperations.error) {
          throw new Error("Failed to get quote operations");
        }

        if (quoteParentMakeMethod.error) {
          throw new Error("Failed to get parent make method");
        }

        const [quoteMethodTrees] = await Promise.all([
          getQuoteMethodTree(client, quoteParentMakeMethod.data.id),
        ]);

        if (quoteMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const fullQuoteMethodTree = quoteMethodTrees
          .data?.[0] as QuoteMethodTreeItem;
        if (!fullQuoteMethodTree) throw new Error("Method tree not found");

        let quoteMethodTree: QuoteMethodTreeItem | null = null;

        console.log({ quoteMakeMethodId, fullQuoteMethodTree });

        traverseQuoteMethod(
          fullQuoteMethodTree,
          (node: QuoteMethodTreeItem) => {
            if (node.data.quoteMaterialMakeMethodId === quoteMakeMethodId) {
              quoteMethodTree = node;
              return;
            }
          }
        );
        if (!quoteMethodTree) throw new Error("Quote method tree not found");

        const madeItemIds: string[] = [];

        traverseQuoteMethod(quoteMethodTree, (node: QuoteMethodTreeItem) => {
          if (node.data.itemId && node.data.methodType === "Make") {
            madeItemIds.push(node.data.itemId);
          }
        });

        const makeMethods = await client
          .from("makeMethod")
          .select("*")
          .in("itemId", madeItemIds);
        if (makeMethods.error) {
          throw new Error("Failed to get make methods");
        }

        const makeMethodByItemId: Record<string, string> = {};
        makeMethods.data?.forEach((m) => {
          makeMethodByItemId[m.itemId] = m.id;
        });

        await db.transaction().execute(async (trx) => {
          let makeMethodsToDelete: string[] = [];
          const materialInserts: Database["public"]["Tables"]["methodMaterial"]["Insert"][] =
            [];
          const operationInserts: Database["public"]["Tables"]["methodOperation"]["Insert"][] =
            [];

          traverseQuoteMethod(quoteMethodTree!, (node: QuoteMethodTreeItem) => {
            if (node.data.itemId && node.data.methodType === "Make") {
              makeMethodsToDelete.push(makeMethodByItemId[node.data.itemId]);
            }

            node.children.forEach((child) => {
              materialInserts.push({
                makeMethodId: makeMethodByItemId[node.data.itemId],
                materialMakeMethodId: makeMethodByItemId[child.data.itemId],
                itemId: child.data.itemId,
                itemReadableId: child.data.itemReadableId,
                itemType: child.data.itemType,
                methodType: child.data.methodType,
                order: child.data.order,
                quantity: child.data.quantity,
                unitOfMeasureCode: child.data.unitOfMeasureCode,
                companyId,
                createdBy: userId,
                customFields: {},
              });
            });
          });

          if (makeMethodsToDelete.length > 0) {
            makeMethodsToDelete = makeMethodsToDelete.map((mm) =>
              mm === makeMethodByItemId[quoteMakeMethod.data.itemId]
                ? makeMethod.data.id
                : mm
            );
            await Promise.all([
              trx
                .deleteFrom("methodMaterial")
                .where("makeMethodId", "in", makeMethodsToDelete)
                .execute(),
              trx
                .deleteFrom("methodOperation")
                .where("makeMethodId", "in", makeMethodsToDelete)
                .execute(),
            ]);
          }

          if (materialInserts.length > 0) {
            await trx
              .insertInto("methodMaterial")
              .values(
                materialInserts.map((insert) => ({
                  ...insert,
                  makeMethodId:
                    insert.makeMethodId ===
                    makeMethodByItemId[quoteMakeMethod.data.itemId]
                      ? makeMethod.data.id
                      : insert.makeMethodId,
                  itemId:
                    insert.itemId === quoteMakeMethod.data.itemId
                      ? itemId
                      : insert.itemId,
                }))
              )
              .execute();
          }

          quoteOperations.data?.forEach((op) => {
            operationInserts.push({
              makeMethodId: op.makeMethodId!,
              processId: op.processId!,
              workCenterId: op.workCenterId,
              description: op.description ?? "",
              setupTime: op.setupTime ?? 0,
              setupUnit: op.setupUnit ?? "Total Minutes",
              laborTime: op.laborTime ?? 0,
              laborUnit: op.laborUnit ?? "Minutes/Piece",
              machineTime: op.machineTime ?? 0,
              machineUnit: op.machineUnit ?? "Minutes/Piece",
              order: op.order ?? 1,
              operationOrder: op.operationOrder ?? "After Previous",
              companyId,
              createdBy: userId,
              customFields: {},
            });
          });

          if (operationInserts.length > 0) {
            await trx
              .insertInto("methodOperation")
              .values(
                operationInserts.map((insert) => ({
                  ...insert,
                  makeMethodId:
                    insert.makeMethodId ===
                    makeMethodByItemId[quoteMakeMethod.data.itemId]
                      ? makeMethod.data.id
                      : insert.makeMethodId,
                }))
              )
              .execute();
          }
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

type Method = NonNullable<
  Awaited<ReturnType<typeof getMethodTreeArray>>["data"]
>[number];
type MethodTreeItem = {
  id: string;
  data: Method;
  children: MethodTreeItem[];
};

export async function getMethodTree(
  client: SupabaseClient<Database>,
  makeMethodId: string
): Promise<{ data: MethodTreeItem[] | null; error: PostgrestError | null }> {
  const items = await getMethodTreeArray(client, makeMethodId);
  if (items.error) return items;

  const tree = getMethodTreeArrayToTree(items.data);

  return {
    data: tree,
    error: null,
  };
}

export function getMethodTreeArray(
  client: SupabaseClient<Database>,
  makeMethodId: string
) {
  return client.rpc("get_method_tree", {
    uid: makeMethodId,
  });
}

function getMethodTreeArrayToTree(items: Method[]): MethodTreeItem[] {
  function traverseAndRenameIds(node: MethodTreeItem) {
    const clone = structuredClone(node);
    clone.id = nanoid(20);
    clone.children = clone.children.map((n) => traverseAndRenameIds(n));
    return clone;
  }

  const rootItems: MethodTreeItem[] = [];
  const lookup: { [id: string]: MethodTreeItem } = {};

  for (const item of items) {
    const itemId = item.methodMaterialId;
    const parentId = item.parentMaterialId;

    if (!Object.prototype.hasOwnProperty.call(lookup, itemId)) {
      // @ts-ignore - we add data on the next line
      lookup[itemId] = { id: itemId, children: [] };
    }

    lookup[itemId]["data"] = item;

    const treeItem = lookup[itemId];

    if (parentId === null || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-ignore - we don't add data here
        lookup[parentId] = { id: parentId, children: [] };
      }

      lookup[parentId]["children"].push(treeItem);
    }
  }

  return rootItems.map((item) => traverseAndRenameIds(item));
}

type QuoteMethod = NonNullable<
  Awaited<ReturnType<typeof getQuoteMethodTreeArray>>["data"]
>[number];
type QuoteMethodTreeItem = {
  id: string;
  data: QuoteMethod;
  children: QuoteMethodTreeItem[];
};

export async function getQuoteMethodTree(
  client: SupabaseClient<Database>,
  methodId: string
) {
  const items = await getQuoteMethodTreeArray(client, methodId);
  if (items.error) return items;

  const tree = getQuoteMethodTreeArrayToTree(items.data);

  return {
    data: tree,
    error: null,
  };
}

export function getQuoteMethodTreeArray(
  client: SupabaseClient<Database>,
  methodId: string
) {
  return client.rpc("get_quote_methods_by_method_id", {
    mid: methodId,
  });
}

function getQuoteMethodTreeArrayToTree(
  items: QuoteMethod[]
): QuoteMethodTreeItem[] {
  // function traverseAndRenameIds(node: QuoteMethodTreeItem) {
  //   const clone = structuredClone(node);
  //   clone.id = `node-${Math.random().toString(16).slice(2)}`;
  //   clone.children = clone.children.map((n) => traverseAndRenameIds(n));
  //   return clone;
  // }

  const rootItems: QuoteMethodTreeItem[] = [];
  const lookup: { [id: string]: QuoteMethodTreeItem } = {};

  for (const item of items) {
    const itemId = item.methodMaterialId;
    const parentId = item.parentMaterialId;

    if (!Object.prototype.hasOwnProperty.call(lookup, itemId)) {
      // @ts-ignore - we don't add data here
      lookup[itemId] = { id: itemId, children: [] };
    }

    lookup[itemId]["data"] = item;

    const treeItem = lookup[itemId];

    if (parentId === null || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-ignore - we don't add data here
        lookup[parentId] = { id: parentId, children: [] };
      }

      lookup[parentId]["children"].push(treeItem);
    }
  }
  return rootItems;
}

function traverseQuoteMethod(
  node: QuoteMethodTreeItem,
  callback: (node: QuoteMethodTreeItem) => void
) {
  callback(node);

  if (node.children) {
    for (const child of node.children) {
      traverseQuoteMethod(child, callback);
    }
  }
}

const getRatesFromWorkCenters =
  (workCenters: Database["public"]["Views"]["workCenters"]["Row"][] | null) =>
  (
    processId: string,
    workCenterId: string | null
  ): { quotingRate: number; laborRate: number } => {
    if (!workCenters) {
      return {
        quotingRate: 0,
        laborRate: 0,
      };
    }

    if (workCenterId) {
      const workCenter = workCenters?.find(
        (wc) => wc.id === workCenterId && wc.active
      );

      if (workCenter) {
        return {
          quotingRate: workCenter.quotingRate ?? 0,
          laborRate: workCenter.laborRate ?? 0,
        };
      }
    }

    const relatedWorkCenters = workCenters.filter((wc) => {
      const processes = (wc.processes ?? []) as { id: string }[];
      return wc.active && processes.some((p) => p.id === processId);
    });

    if (relatedWorkCenters.length > 0) {
      const quotingRate =
        relatedWorkCenters.reduce((acc, workCenter) => {
          return (acc += workCenter.quotingRate ?? 0);
        }, 0) / relatedWorkCenters.length;
      const laborRate =
        relatedWorkCenters.reduce((acc, workCenter) => {
          return (acc += workCenter.laborRate ?? 0);
        }, 0) / relatedWorkCenters.length;

      return {
        quotingRate,
        laborRate,
      };
    }

    return {
      quotingRate: 0,
      laborRate: 0,
    };
  };
