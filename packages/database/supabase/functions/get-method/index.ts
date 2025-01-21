import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";

import type {
  PostgrestError,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.33.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import type { Database } from "../lib/types.ts";

import { corsHeaders } from "../lib/headers.ts";
import {
  getJobMethodTree,
  getQuoteMethodTree,
  getRatesFromSupplierProcesses,
  getRatesFromWorkCenters,
  JobMethodTreeItem,
  QuoteMethodTreeItem,
  traverseJobMethod,
  traverseQuoteMethod,
} from "../lib/methods.ts";
import { importTypeScript } from "../lib/sandbox.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  type: z.enum([
    "itemToItem",
    "itemToJob",
    "itemToJobMakeMethod",
    "itemToQuoteLine",
    "itemToQuoteMakeMethod",
    "jobMakeMethodToItem",
    "jobToItem",
    "quoteLineToItem",
    "quoteLineToJob",
    "quoteMakeMethodToItem",
  ]),
  sourceId: z.string(),
  targetId: z.string(),
  companyId: z.string(),
  userId: z.string(),
  configuration: z.record(z.unknown()).optional(),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  try {
    const { type, sourceId, targetId, companyId, userId, configuration } =
      payloadValidator.parse(payload);

    console.log({
      function: "get-method",
      type,
      sourceId,
      targetId,
      companyId,
      userId,
      configuration,
    });

    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

    switch (type) {
      case "itemToItem": {
        const [sourceMakeMethod, targetMakeMethod] = await Promise.all([
          client.from("makeMethod").select("*").eq("itemId", sourceId).single(),
          client.from("makeMethod").select("*").eq("itemId", targetId).single(),
        ]);

        if (sourceMakeMethod.error || targetMakeMethod.error) {
          throw new Error("Failed to get make methods");
        }

        const [sourceMaterials, sourceOperations] = await Promise.all([
          client
            .from("methodMaterial")
            .select("*")
            .eq("makeMethodId", sourceMakeMethod.data.id),
          client
            .from("methodOperation")
            .select(
              "*, methodOperationTool(id, operationId, toolId, quantity, createdBy, createdAt, updatedBy, updatedAt)"
            )
            .eq("makeMethodId", sourceMakeMethod.data.id),
        ]);

        if (sourceMaterials.error || sourceOperations.error) {
          throw new Error("Failed to get source materials or operations");
        }

        await db.transaction().execute(async (trx) => {
          // Delete existing materials and operations from target method
          await Promise.all([
            trx
              .deleteFrom("methodMaterial")
              .where("makeMethodId", "=", targetMakeMethod.data.id)
              .execute(),
            trx
              .deleteFrom("methodOperation")
              .where("makeMethodId", "=", targetMakeMethod.data.id)
              .execute(),
          ]);

          // Copy materials from source to target
          if (sourceMaterials.data && sourceMaterials.data.length > 0) {
            await trx
              .insertInto("methodMaterial")
              .values(
                sourceMaterials.data.map((material) => ({
                  ...material,
                  productionQuantity: undefined,
                  id: undefined, // Let the database generate a new ID
                  makeMethodId: targetMakeMethod.data.id,
                  createdBy: userId,
                }))
              )
              .execute();
          }

          // Copy operations from source to target
          if (sourceOperations.data && sourceOperations.data.length > 0) {
            const operationIds = await trx
              .insertInto("methodOperation")
              .values(
                sourceOperations.data.map(
                  ({ methodOperationTool: _tools, ...operation }) => ({
                    ...operation,
                    id: undefined, // Let the database generate a new ID
                    makeMethodId: targetMakeMethod.data.id,
                    createdBy: userId,
                  })
                )
              )
              .returning(["id"])
              .execute();

            for await (const [
              index,
              operation,
            ] of sourceOperations.data.entries()) {
              const { methodOperationTool } = operation;
              const operationId = operationIds[index].id;

              if (
                operationId &&
                Array.isArray(methodOperationTool) &&
                methodOperationTool.length > 0
              ) {
                await trx
                  .insertInto("methodOperationTool")
                  .values(
                    methodOperationTool.map((tool) => ({
                      toolId: tool.toolId,
                      quantity: tool.quantity,
                      operationId,
                      companyId,
                      createdBy: userId,
                    }))
                  )
                  .execute();
              }
            }
          }
        });

        break;
      }
      case "itemToJob": {
        const jobId = targetId;
        if (!jobId) {
          throw new Error("Invalid targetId");
        }
        const itemId = sourceId;
        const isConfigured = !!configuration;

        const [makeMethod, jobMakeMethod, workCenters, supplierProcesses] =
          await Promise.all([
            client.from("makeMethod").select("*").eq("itemId", itemId).single(),
            client
              .from("jobMakeMethod")
              .select("*")
              .eq("jobId", jobId)
              .is("parentMaterialId", null)
              .single(),
            client.from("workCenters").select("*").eq("companyId", companyId),
            client
              .from("supplierProcess")
              .select("*")
              .eq("companyId", companyId),
          ]);

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (jobMakeMethod.error) {
          throw new Error("Failed to get job make method");
        }

        if (workCenters.error) {
          throw new Error("Failed to get related work centers");
        }

        const [methodTrees, configurationRules] = await Promise.all([
          getMethodTree(client, makeMethod.data.id),
          isConfigured
            ? client
                .from("configurationRule")
                .select("*")
                .eq("itemId", itemId)
                .eq("companyId", companyId)
            : Promise.resolve({ data: [] }),
        ]);

        if (methodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const methodTree = methodTrees.data?.[0] as MethodTreeItem;
        if (!methodTree) throw new Error("Method tree not found");

        const getLaborAndOverheadRates = getRatesFromWorkCenters(
          workCenters?.data
        );
        const getOutsideOperationRates = getRatesFromSupplierProcesses(
          supplierProcesses?.data
        );

        // Get configuration code by field
        const configurationCodeByField = configurationRules.data?.reduce<
          Record<string, string>
        >((acc, rule) => {
          acc[rule.field] = rule.code;
          return acc;
        }, {});

        await db.transaction().execute(async (trx) => {
          // Delete existing jobMakeMethod, jobMakeMethodOperation, jobMakeMethodMaterial
          await Promise.all([
            trx
              .deleteFrom("jobMakeMethod")
              .where((eb) =>
                eb.and([
                  eb("jobId", "=", jobId),
                  eb("parentMaterialId", "is not", null),
                ])
              )
              .execute(),
            trx.deleteFrom("jobMaterial").where("jobId", "=", jobId).execute(),
            trx.deleteFrom("jobOperation").where("jobId", "=", jobId).execute(),
          ]);

          async function getConfiguredValue<T>({
            id,
            field,
            defaultValue,
          }: {
            id: string;
            field: string;
            defaultValue: T;
          }): Promise<T> {
            const configurationKey = `${id}:${field}`;

            if (configurationCodeByField?.[configurationKey]) {
              try {
                const mod = await importTypeScript(
                  configurationCodeByField[configurationKey]
                );
                const result = await mod.configure(configuration);
                return (result ?? defaultValue) as T;
              } catch (err) {
                console.error(err);
                return defaultValue;
              }
            }

            return defaultValue;
          }

          // traverse method tree and create:
          // - jobMakeMethod
          // - jobMakeMethodOperation
          // - jobMakeMethodMaterial
          async function traverseMethod(
            node: MethodTreeItem,
            parentJobMakeMethodId: string | null
          ) {
            const nodeLevelConfigurationKey = `${
              node.data.materialMakeMethodId
            }:${node.data.isRoot ? "undefined" : node.data.methodMaterialId}`;

            const relatedOperations = await client
              .from("methodOperation")
              .select(
                "*, methodOperationTool(id, operationId, toolId, quantity, createdBy, createdAt, updatedBy, updatedAt)"
              )
              .eq("makeMethodId", node.data.materialMakeMethodId);

            let jobOperationsInserts: Database["public"]["Tables"]["jobOperation"]["Insert"][] =
              [];
            for await (const op of relatedOperations?.data ?? []) {
              const [
                processId,
                workCenterId,
                description,
                setupTime,
                setupUnit,
                laborTime,
                laborUnit,
                machineTime,
                machineUnit,
                operationOrder,
                operationType,
              ] = await Promise.all([
                getConfiguredValue({
                  id: op.id,
                  field: "processId",
                  defaultValue: op.processId,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "workCenterId",
                  defaultValue: op.workCenterId,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "description",
                  defaultValue: op.description,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "setupTime",
                  defaultValue: op.setupTime,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "setupUnit",
                  defaultValue: op.setupUnit,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "laborTime",
                  defaultValue: op.laborTime,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "laborUnit",
                  defaultValue: op.laborUnit,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "machineTime",
                  defaultValue: op.machineTime,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "machineUnit",
                  defaultValue: op.machineUnit,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "operationOrder",
                  defaultValue: op.operationOrder,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "operationType",
                  defaultValue: op.operationType,
                }),
              ]);

              jobOperationsInserts.push({
                jobId,
                jobMakeMethodId: parentJobMakeMethodId!,
                processId,
                workCenterId,
                description,
                setupTime,
                setupUnit,
                laborTime,
                laborUnit,
                machineTime,
                machineUnit,
                ...getLaborAndOverheadRates(processId, op.workCenterId),
                order: op.order,
                operationOrder,
                operationType,
                operationSupplierProcessId: op.operationSupplierProcessId,
                ...getOutsideOperationRates(
                  processId,
                  op.operationSupplierProcessId
                ),
                workInstruction: op.workInstruction,
                companyId,
                createdBy: userId,
                customFields: {},
              });
            }

            const bopConfigurationKey = `billOfProcess:${nodeLevelConfigurationKey}`;
            let bopConfiguration: string[] | null = null;

            if (configurationCodeByField?.[bopConfigurationKey]) {
              const mod = await importTypeScript(
                configurationCodeByField[bopConfigurationKey]
              );
              bopConfiguration = await mod.configure(configuration);
            }

            if (bopConfiguration) {
              // @ts-expect-error - we can't assign undefined to materialsWithConfiguredFields but we filter them in the next step
              jobOperationsInserts = bopConfiguration
                .map((description, index) => {
                  const operation = jobOperationsInserts.find(
                    (operation) => operation.description === description
                  );
                  if (operation) {
                    return {
                      ...operation,
                      order: index + 1,
                    };
                  }
                })
                .filter(Boolean);
            }

            let methodOperationsToJobOperations: Record<string, string> = {};
            if (jobOperationsInserts?.length > 0) {
              const operationIds = await trx
                .insertInto("jobOperation")
                .values(jobOperationsInserts)
                .returning(["id"])
                .execute();

              for (const [index, operation] of (
                relatedOperations.data ?? []
              ).entries()) {
                const operationId = operationIds[index].id;

                if (operationId) {
                  const { methodOperationTool } = operation;
                  if (
                    Array.isArray(methodOperationTool) &&
                    methodOperationTool.length > 0
                  ) {
                    await trx
                      .insertInto("jobOperationTool")
                      .values(
                        methodOperationTool.map((tool) => ({
                          toolId: tool.toolId,
                          quantity: tool.quantity,
                          operationId,
                          companyId,
                          createdBy: userId,
                        }))
                      )
                      .execute();
                  }
                }
              }

              methodOperationsToJobOperations =
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

            const mapMethodMaterialToJobMaterial = async (
              child: MethodTreeItem
            ) => {
              let [
                itemId,
                description,
                quantity,
                methodType,
                unitOfMeasureCode,
              ] = await Promise.all([
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "itemId",
                  defaultValue: child.data.itemId,
                }),
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "description",
                  defaultValue: child.data.description,
                }),
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "quantity",
                  defaultValue: child.data.quantity,
                }),
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "methodType",
                  defaultValue: child.data.methodType,
                }),
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "unitOfMeasureCode",
                  defaultValue: child.data.unitOfMeasureCode,
                }),
              ]);

              let itemReadableId = child.data.itemReadableId;
              let itemType = child.data.itemType;
              let unitCost = child.data.unitCost;

              if (itemId !== child.data.itemId) {
                const item = await client
                  .from("item")
                  .select("readableId, type, name, itemCost(unitCost)")
                  .eq("id", itemId)
                  .single();
                if (item.data) {
                  itemReadableId = item.data.readableId;
                  itemType = item.data.type;
                  unitCost =
                    item.data.itemCost[0]?.unitCost ?? child.data.unitCost;
                  if (description === child.data.description) {
                    description = item.data.name;
                  }
                } else {
                  itemId = child.data.itemId;
                }
              }

              return {
                jobId,
                jobMakeMethodId: parentJobMakeMethodId!,
                jobOperationId:
                  methodOperationsToJobOperations[child.data.operationId],
                itemId,
                itemReadableId,
                itemType,
                methodType,
                order: child.data.order,
                description,
                quantity,
                unitOfMeasureCode,
                unitCost,
                companyId,
                createdBy: userId,
                customFields: {},
              };
            };

            let materialsWithConfiguredFields = await Promise.all(
              node.children.map(mapMethodMaterialToJobMaterial)
            );

            const bomConfigurationKey = `billOfMaterial:${nodeLevelConfigurationKey}`;
            let bomConfiguration: string[] | null = null;

            if (configurationCodeByField?.[bomConfigurationKey]) {
              const mod = await importTypeScript(
                configurationCodeByField[bomConfigurationKey]
              );
              bomConfiguration = await mod.configure(configuration);
            }

            if (bomConfiguration) {
              // @ts-expect-error - we can't assign undefined to materialsWithConfiguredFields but we filter them in the next step
              materialsWithConfiguredFields = bomConfiguration
                .map((readableId, index) => {
                  const material = materialsWithConfiguredFields.find(
                    (material) => material.itemReadableId === readableId
                  );
                  if (material) {
                    return {
                      ...material,
                      order: index + 1,
                    };
                  }
                })
                .filter(Boolean);
            }

            const madeMaterials = materialsWithConfiguredFields.filter(
              (material) => material.methodType === "Make"
            );

            const pickedOrBoughtMaterials =
              materialsWithConfiguredFields.filter(
                (material) => material.methodType !== "Make"
              );

            const madeChildren = madeMaterials.map((material, index) => {
              const childIndex = materialsWithConfiguredFields.findIndex(
                (m) => m.itemReadableId === material.itemReadableId
              );
              return node.children[childIndex];
            });

            if (madeMaterials.length > 0) {
              const madeMaterialIds = await trx
                .insertInto("jobMaterial")
                .values(madeMaterials)
                .returning(["id"])
                .execute();

              const jobMakeMethods = await trx
                .selectFrom("jobMakeMethod")
                .select(["id"])
                .where(
                  "parentMaterialId",
                  "in",
                  madeMaterialIds.map((m) => m.id)
                )
                .execute();

              for (const [index, child] of madeChildren.entries()) {
                const makeMethodId = jobMakeMethods[index].id ?? null;
                // prevent an infinite loop
                if (child.data.itemId !== itemId) {
                  await traverseMethod(child, makeMethodId);
                }
              }
            }

            if (pickedOrBoughtMaterials.length > 0) {
              await trx
                .insertInto("jobMaterial")
                .values(pickedOrBoughtMaterials)
                .execute();
            }
          }

          await traverseMethod(methodTree, jobMakeMethod.data.id);
        });

        break;
      }
      case "itemToJobMakeMethod": {
        const jobMakeMethodId = targetId;

        if (!jobMakeMethodId) {
          throw new Error("Invalid targetId");
        }
        const itemId = sourceId;

        const [makeMethod, jobMakeMethod, workCenters, supplierProcesses] =
          await Promise.all([
            client.from("makeMethod").select("*").eq("itemId", itemId).single(),
            client
              .from("jobMakeMethod")
              .select("*")
              .eq("id", jobMakeMethodId)
              .single(),
            client.from("workCenters").select("*").eq("companyId", companyId),
            client
              .from("supplierProcess")
              .select("*")
              .eq("companyId", companyId),
          ]);

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (jobMakeMethod.error || !jobMakeMethod.data) {
          throw new Error("Failed to get job make method");
        }

        const [methodTrees] = await Promise.all([
          getMethodTree(client, makeMethod.data.id),
        ]);

        if (methodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const methodTree = methodTrees.data?.[0] as MethodTreeItem;
        if (!methodTree) throw new Error("Method tree not found");

        const getLaborAndOverheadRates = getRatesFromWorkCenters(
          workCenters?.data
        );
        const getOutsideOperationRates = getRatesFromSupplierProcesses(
          supplierProcesses?.data
        );

        await db.transaction().execute(async (trx) => {
          // Delete existing jobMakeMethodOperation, jobMakeMethodMaterial
          await Promise.all([
            trx
              .deleteFrom("jobMaterial")
              .where("jobMakeMethodId", "=", jobMakeMethodId)
              .execute(),
            trx
              .deleteFrom("jobOperation")
              .where("jobMakeMethodId", "=", jobMakeMethodId)
              .execute(),
          ]);

          // traverse method tree and create:
          // - jobMakeMethod
          // - jobMakeMethodOperation
          // - jobMakeMethodMaterial
          async function traverseMethod(
            node: MethodTreeItem,
            parentJobMakeMethodId: string | null
          ) {
            const relatedOperations = await client
              .from("methodOperation")
              .select(
                "*, methodOperationTool(id, operationId, toolId, quantity, createdBy, createdAt, updatedBy, updatedAt)"
              )
              .eq("makeMethodId", node.data.materialMakeMethodId);

            const jobOperationsInserts =
              relatedOperations?.data?.map((op) => ({
                jobId: jobMakeMethod.data?.jobId!,
                jobMakeMethodId: parentJobMakeMethodId!,
                processId: op.processId,
                workCenterId: op.workCenterId,
                description: op.description,
                setupTime: op.setupTime,
                setupUnit: op.setupUnit,
                laborTime: op.laborTime,
                laborUnit: op.laborUnit,
                machineTime: op.machineTime,
                machineUnit: op.machineUnit,
                ...getLaborAndOverheadRates(op.processId, op.workCenterId),
                order: op.order,
                operationOrder: op.operationOrder,
                operationType: op.operationType,
                operationSupplierProcessId: op.operationSupplierProcessId,
                ...getOutsideOperationRates(
                  op.processId,
                  op.operationSupplierProcessId
                ),
                tags: op.tags ?? [],
                workInstruction: op.workInstruction,
                companyId,
                createdBy: userId,
                customFields: {},
              })) ?? [];

            let methodOperationsToJobOperations: Record<string, string> = {};
            if (jobOperationsInserts?.length > 0) {
              const operationIds = await trx
                .insertInto("jobOperation")
                .values(jobOperationsInserts)
                .returning(["id"])
                .execute();

              for (const [index, operation] of (
                relatedOperations.data ?? []
              ).entries()) {
                const operationId = operationIds[index].id;

                if (operationId) {
                  const { methodOperationTool } = operation;
                  if (
                    Array.isArray(methodOperationTool) &&
                    methodOperationTool.length > 0
                  ) {
                    await trx
                      .insertInto("jobOperationTool")
                      .values(
                        methodOperationTool.map((tool) => ({
                          toolId: tool.toolId,
                          quantity: tool.quantity,
                          operationId,
                          companyId,
                          createdBy: userId,
                        }))
                      )
                      .execute();
                  }
                }
              }

              methodOperationsToJobOperations =
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

            const mapMethodMaterialToJobMaterial = (child: MethodTreeItem) => ({
              jobId: jobMakeMethod.data?.jobId!,
              jobMakeMethodId: parentJobMakeMethodId!,
              jobOperationId:
                methodOperationsToJobOperations[child.data.operationId],
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
              mapMethodMaterialToJobMaterial
            );
            const pickedOrBoughtMaterials = unmadeChildren.map(
              mapMethodMaterialToJobMaterial
            );
            if (madeMaterials.length > 0) {
              const madeMaterialIds = await trx
                .insertInto("jobMaterial")
                .values(madeMaterials)
                .returning(["id"])
                .execute();

              const jobMakeMethods = await trx
                .selectFrom("jobMakeMethod")
                .select(["id"])
                .where(
                  "parentMaterialId",
                  "in",
                  madeMaterialIds.map((m) => m.id)
                )
                .execute();

              for (const [index, child] of madeChildren.entries()) {
                const makeMethodId = jobMakeMethods[index].id ?? null;
                // prevent an infinite loop
                if (child.data.itemId !== itemId) {
                  await traverseMethod(child, makeMethodId);
                }
              }
            }

            if (pickedOrBoughtMaterials.length > 0) {
              await trx
                .insertInto("jobMaterial")
                .values(pickedOrBoughtMaterials)
                .execute();
            }
          }

          await traverseMethod(methodTree, jobMakeMethod.data.id);
        });
        break;
      }
      case "itemToQuoteLine": {
        const [quoteId, quoteLineId] = (targetId as string).split(":");
        if (!quoteId || !quoteLineId) {
          throw new Error("Invalid targetId");
        }
        const itemId = sourceId;
        const isConfigured = !!configuration;

        const [
          makeMethod,
          quoteMakeMethod,
          workCenters,
          supplierProcesses,
          configurationRules,
        ] = await Promise.all([
          client.from("makeMethod").select("*").eq("itemId", itemId).single(),
          client
            .from("quoteMakeMethod")
            .select("*")
            .eq("quoteLineId", quoteLineId)
            .is("parentMaterialId", null)
            .single(),
          client.from("workCenters").select("*").eq("companyId", companyId),
          client.from("supplierProcess").select("*").eq("companyId", companyId),
          isConfigured
            ? client
                .from("configurationRule")
                .select("field, code")
                .eq("itemId", itemId)
            : Promise.resolve({ data: null, error: null }),
        ]);

        const configurationCodeByField = configurationRules?.data?.reduce<
          Record<string, string>
        >((acc, rule) => {
          acc[rule.field] = rule.code;
          return acc;
        }, {});

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

        const getLaborAndOverheadRates = getRatesFromWorkCenters(
          workCenters?.data
        );
        const getOutsideOperationRates = getRatesFromSupplierProcesses(
          supplierProcesses?.data
        );

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

          async function getConfiguredValue<
            T extends number | string | boolean | null
          >({
            id,
            field,
            defaultValue,
          }: {
            id: string;
            field: string;
            defaultValue: T;
          }): Promise<T> {
            if (!configurationCodeByField) return defaultValue;

            const fieldKey = getFieldKey(field, id);
            if (configurationCodeByField[fieldKey]) {
              try {
                const code = configurationCodeByField[fieldKey];
                const mod = await importTypeScript(code);
                const result = await mod.configure(configuration);

                return (result ?? defaultValue) as T;
              } catch (err) {
                console.error(err);
                return defaultValue;
              }
            }

            return defaultValue;
          }

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
              .select(
                "*, methodOperationTool(id, operationId, toolId, quantity, createdBy, createdAt, updatedBy, updatedAt)"
              )
              .eq("makeMethodId", node.data.materialMakeMethodId);

            let quoteOperationsInserts: Database["public"]["Tables"]["quoteOperation"]["Insert"][] =
              [];
            for await (const op of relatedOperations?.data ?? []) {
              const [
                processId,
                workCenterId,
                description,
                setupTime,
                setupUnit,
                laborTime,
                laborUnit,
                machineTime,
                machineUnit,
                operationOrder,
                operationType,
              ] = await Promise.all([
                getConfiguredValue({
                  id: op.id,
                  field: "processId",
                  defaultValue: op.processId,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "workCenterId",
                  defaultValue: op.workCenterId,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "description",
                  defaultValue: op.description,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "setupTime",
                  defaultValue: op.setupTime,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "setupUnit",
                  defaultValue: op.setupUnit,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "laborTime",
                  defaultValue: op.laborTime,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "laborUnit",
                  defaultValue: op.laborUnit,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "machineTime",
                  defaultValue: op.machineTime,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "machineUnit",
                  defaultValue: op.machineUnit,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "operationOrder",
                  defaultValue: op.operationOrder,
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "operationType",
                  defaultValue: op.operationType,
                }),
              ]);

              quoteOperationsInserts.push({
                quoteId,
                quoteLineId,
                quoteMakeMethodId: parentQuoteMakeMethodId!,
                processId,
                workCenterId,
                description,
                setupTime,
                setupUnit,
                laborTime,
                laborUnit,
                machineTime,
                machineUnit,
                ...getLaborAndOverheadRates(processId, op.workCenterId),
                order: op.order,
                operationOrder,
                operationType,
                operationSupplierProcessId: op.operationSupplierProcessId,
                ...getOutsideOperationRates(
                  processId,
                  op.operationSupplierProcessId
                ),
                tags: op.tags ?? [],
                workInstruction: op.workInstruction,
                companyId,
                createdBy: userId,
                customFields: {},
              });
            }

            const nodeLevelConfigurationKey = `${
              node.data.materialMakeMethodId
            }:${node.data.isRoot ? "undefined" : node.data.methodMaterialId}`;

            const bopConfigurationKey = `billOfProcess:${nodeLevelConfigurationKey}`;
            let bopConfiguration: string[] | null = null;

            if (configurationCodeByField?.[bopConfigurationKey]) {
              const mod = await importTypeScript(
                configurationCodeByField[bopConfigurationKey]
              );
              bopConfiguration = await mod.configure(configuration);
            }

            if (bopConfiguration) {
              // @ts-expect-error - we can't assign undefined to materialsWithConfiguredFields but we filter them in the next step
              quoteOperationsInserts = bopConfiguration
                .map((description, index) => {
                  const operation = quoteOperationsInserts.find(
                    (operation) => operation.description === description
                  );
                  if (operation) {
                    return {
                      ...operation,
                      order: index + 1,
                    };
                  }
                })
                .filter(Boolean);
            }

            let methodOperationsToQuoteOperations: Record<string, string> = {};
            if (quoteOperationsInserts?.length > 0) {
              const operationIds = await trx
                .insertInto("quoteOperation")
                .values(quoteOperationsInserts)
                .returning(["id"])
                .execute();

              for (const [index, operation] of (
                relatedOperations.data ?? []
              ).entries()) {
                const operationId = operationIds[index].id;

                if (operationId) {
                  const { methodOperationTool } = operation;
                  if (
                    Array.isArray(methodOperationTool) &&
                    methodOperationTool.length > 0
                  ) {
                    await trx
                      .insertInto("quoteOperationTool")
                      .values(
                        methodOperationTool.map((tool) => ({
                          toolId: tool.toolId,
                          quantity: tool.quantity,
                          operationId,
                          companyId,
                          createdBy: userId,
                        }))
                      )
                      .execute();
                  }
                }
              }

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

            const mapMethodMaterialToQuoteMaterial = async (
              child: MethodTreeItem
            ) => {
              let [
                itemId,
                description,
                quantity,
                methodType,
                unitOfMeasureCode,
              ] = await Promise.all([
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "itemId",
                  defaultValue: child.data.itemId,
                }),
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "description",
                  defaultValue: child.data.description,
                }),
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "quantity",
                  defaultValue: child.data.quantity,
                }),
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "methodType",
                  defaultValue: child.data.methodType,
                }),
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "unitOfMeasureCode",
                  defaultValue: child.data.unitOfMeasureCode,
                }),
              ]);

              let itemReadableId = child.data.itemReadableId;
              let itemType = child.data.itemType;
              let unitCost = child.data.unitCost;

              // TODO: if the methodType is Make and the default value is not Make, we need to do itemToQuoteMakeMethod for that material

              if (itemId !== child.data.itemId) {
                const item = await client
                  .from("item")
                  .select("readableId, type, name, itemCost(unitCost)")
                  .eq("id", itemId)
                  .single();
                if (item.data) {
                  itemReadableId = item.data.readableId;
                  itemType = item.data.type;
                  unitCost =
                    item.data.itemCost[0]?.unitCost ?? child.data.unitCost;
                  if (description === child.data.description) {
                    description = item.data.name;
                  }
                } else {
                  itemId = child.data.itemId;
                }
              }

              return {
                quoteId,
                quoteLineId,
                quoteMakeMethodId: parentQuoteMakeMethodId!,
                quoteOperationId:
                  methodOperationsToQuoteOperations[child.data.operationId],
                order: child.data.order,
                itemId,
                itemReadableId,
                itemType,
                methodType,
                description,
                quantity,
                unitOfMeasureCode,
                unitCost,
                companyId,
                createdBy: userId,
                customFields: {},
              };
            };

            let materialsWithConfiguredFields = await Promise.all(
              node.children.map(mapMethodMaterialToQuoteMaterial)
            );

            const bomConfigurationKey = `billOfMaterial:${nodeLevelConfigurationKey}`;
            let bomConfiguration: string[] | null = null;

            if (configurationCodeByField?.[bomConfigurationKey]) {
              const mod = await importTypeScript(
                configurationCodeByField[bomConfigurationKey]
              );
              bomConfiguration = await mod.configure(configuration);
            }

            if (bomConfiguration) {
              // @ts-expect-error - we can't assign undefined to materialsWithConfiguredFields but we filter them in the next step
              materialsWithConfiguredFields = bomConfiguration
                .map((readableId, index) => {
                  const material = materialsWithConfiguredFields.find(
                    (material) => material.itemReadableId === readableId
                  );
                  if (material) {
                    return {
                      ...material,
                      order: index + 1,
                    };
                  }
                })
                .filter(Boolean);
            }

            const madeMaterials = materialsWithConfiguredFields.filter(
              (material) => material.methodType === "Make"
            );

            const pickedOrBoughtMaterials =
              materialsWithConfiguredFields.filter(
                (material) => material.methodType !== "Make"
              );

            const madeChildren = madeMaterials.map((material, index) => {
              const childIndex = materialsWithConfiguredFields.findIndex(
                (m) => m.itemReadableId === material.itemReadableId
              );
              return node.children[childIndex];
            });

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

        const [makeMethod, quoteMakeMethod, workCenters, supplierProcesses] =
          await Promise.all([
            client.from("makeMethod").select("*").eq("itemId", itemId).single(),
            client
              .from("quoteMakeMethod")
              .select("*")
              .eq("id", quoteMakeMethodId)
              .single(),
            client.from("workCenters").select("*").eq("companyId", companyId),
            client
              .from("supplierProcess")
              .select("*")
              .eq("companyId", companyId),
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

        const getLaborAndOverheadRates = getRatesFromWorkCenters(
          workCenters?.data
        );
        const getOutsideOperationRates = getRatesFromSupplierProcesses(
          supplierProcesses?.data
        );

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
              .select(
                "*, methodOperationTool(id, operationId, toolId, quantity, createdBy, createdAt, updatedBy, updatedAt)"
              )
              .eq("makeMethodId", node.data.materialMakeMethodId);

            const quoteOperationInserts =
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
                ...getLaborAndOverheadRates(op.processId, op.workCenterId),
                order: op.order,
                operationOrder: op.operationOrder,
                operationType: op.operationType,
                operationSupplierProcessId: op.operationSupplierProcessId,
                ...getOutsideOperationRates(
                  op.processId,
                  op.operationSupplierProcessId
                ),
                tags: op.tags ?? [],
                workInstruction: op.workInstruction,
                companyId,
                createdBy: userId,
                customFields: {},
              })) ?? [];

            let methodOperationsToQuoteOperations: Record<string, string> = {};
            if (quoteOperationInserts?.length > 0) {
              const operationIds = await trx
                .insertInto("quoteOperation")
                .values(quoteOperationInserts)
                .returning(["id"])
                .execute();

              for (const [index, operation] of (
                relatedOperations.data ?? []
              ).entries()) {
                const operationId = operationIds[index].id;

                if (operationId) {
                  const { methodOperationTool } = operation;
                  if (
                    Array.isArray(methodOperationTool) &&
                    methodOperationTool.length > 0
                  ) {
                    await trx
                      .insertInto("quoteOperationTool")
                      .values(
                        methodOperationTool.map((tool) => ({
                          toolId: tool.toolId,
                          quantity: tool.quantity,
                          operationId,
                          companyId,
                          createdBy: userId,
                        }))
                      )
                      .execute();
                  }
                }
              }

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
      case "jobMakeMethodToItem": {
        const jobMakeMethodId = sourceId;
        const itemId = targetId;

        const [makeMethod, jobMakeMethod] = await Promise.all([
          client.from("makeMethod").select("*").eq("itemId", itemId).single(),
          client
            .from("jobMakeMethod")
            .select("*")
            .eq("id", jobMakeMethodId)
            .single(),
        ]);

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (jobMakeMethod.error) {
          throw new Error("Failed to get job make method");
        }

        const [jobOperations] = await Promise.all([
          client
            .from("jobOperationsWithMakeMethods")
            .select(
              "*, jobOperationTool(id, operationId, toolId, quantity, createdBy, createdAt, updatedBy, updatedAt)"
            )
            .eq("jobId", jobMakeMethod.data.jobId),
        ]);

        if (jobOperations.error) {
          throw new Error("Failed to get job operations");
        }

        const [jobMethodTrees] = await Promise.all([
          getJobMethodTree(
            client,
            jobMakeMethodId,
            jobMakeMethod.data.parentMaterialId
          ),
        ]);

        if (jobMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        if (jobMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const jobMethodTree = jobMethodTrees.data?.[0] as JobMethodTreeItem;
        if (!jobMethodTree) throw new Error("Job method tree not found");

        const madeItemIds: string[] = [];

        traverseJobMethod(jobMethodTree, (node: JobMethodTreeItem) => {
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

          traverseJobMethod(jobMethodTree!, (node: JobMethodTreeItem) => {
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
              mm === makeMethodByItemId[jobMakeMethod.data.itemId]
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
                  productionQuantity: undefined,
                  makeMethodId:
                    insert.makeMethodId ===
                    makeMethodByItemId[jobMakeMethod.data.itemId]
                      ? makeMethod.data.id
                      : insert.makeMethodId,
                  itemId:
                    insert.itemId === jobMakeMethod.data.itemId
                      ? itemId
                      : insert.itemId,
                }))
              )
              .execute();
          }

          jobOperations.data?.forEach((op) => {
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
              operationType: op.operationType ?? "Inside",
              tags: op.tags ?? [],
              workInstruction: op.workInstruction,
              companyId,
              createdBy: userId,
              customFields: {},
            });
          });

          if (operationInserts.length > 0) {
            const operationIds = await trx
              .insertInto("methodOperation")
              .values(
                operationInserts.map((insert) => ({
                  ...insert,
                  makeMethodId:
                    insert.makeMethodId ===
                    makeMethodByItemId[jobMakeMethod.data.itemId]
                      ? makeMethod.data.id
                      : insert.makeMethodId,
                }))
              )
              .returning(["id"])
              .execute();

            for (const [index, operation] of (
              jobOperations.data ?? []
            ).entries()) {
              const operationId = operationIds[index].id;
              if (operationId) {
                const { jobOperationTool } = operation;
                if (
                  Array.isArray(jobOperationTool) &&
                  jobOperationTool.length > 0
                ) {
                  await trx
                    .insertInto("methodOperationTool")
                    .values(
                      jobOperationTool.map((tool) => ({
                        toolId: tool.toolId,
                        quantity: tool.quantity,
                        operationId,
                        companyId,
                        createdBy: userId,
                      }))
                    )
                    .execute();
                }
              }
            }
          }
        });

        break;
      }
      case "jobToItem": {
        const jobId = sourceId;
        if (!jobId) {
          throw new Error("Invalid sourceId");
        }
        const itemId = targetId;

        const [makeMethod, jobMakeMethod, jobOperations] = await Promise.all([
          client.from("makeMethod").select("*").eq("itemId", itemId).single(),
          client
            .from("jobMakeMethod")
            .select("*")
            .eq("jobId", jobId)
            .is("parentMaterialId", null)
            .single(),
          client
            .from("jobOperationsWithMakeMethods")
            .select(
              "*, jobOperationTool(id, operationId, toolId, quantity, createdBy, createdAt, updatedBy, updatedAt)"
            )
            .eq("jobId", jobId),
        ]);

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (jobMakeMethod.error) {
          throw new Error("Failed to get job make method");
        }

        if (jobOperations.error) {
          throw new Error("Failed to get job operations");
        }

        const [jobMethodTrees] = await Promise.all([
          getJobMethodTree(client, jobMakeMethod.data.id),
        ]);

        if (jobMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const jobMethodTree = jobMethodTrees.data?.[0] as JobMethodTreeItem;
        if (!jobMethodTree) throw new Error("Method tree not found");

        const madeItemIds: string[] = [];

        traverseJobMethod(jobMethodTree, (node: JobMethodTreeItem) => {
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

          traverseJobMethod(jobMethodTree, (node: JobMethodTreeItem) => {
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
              mm === makeMethodByItemId[jobMakeMethod.data.itemId]
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
                  productionQuantity: undefined,
                  makeMethodId:
                    insert.makeMethodId ===
                    makeMethodByItemId[jobMakeMethod.data.itemId]
                      ? makeMethod.data.id
                      : insert.makeMethodId,
                  itemId:
                    insert.itemId === jobMakeMethod.data.itemId
                      ? itemId
                      : insert.itemId,
                }))
              )
              .execute();
          }

          jobOperations.data?.forEach((op) => {
            operationInserts.push({
              makeMethodId: op.makeMethodId!,
              processId: op.processId!,
              // workCenterId: op.workCenterId,
              description: op.description ?? "",
              setupTime: op.setupTime ?? 0,
              setupUnit: op.setupUnit ?? "Total Minutes",
              laborTime: op.laborTime ?? 0,
              laborUnit: op.laborUnit ?? "Minutes/Piece",
              machineTime: op.machineTime ?? 0,
              machineUnit: op.machineUnit ?? "Minutes/Piece",
              order: op.order ?? 1,
              operationOrder: op.operationOrder ?? "After Previous",
              operationType: op.operationType ?? "Inside",
              operationSupplierProcessId: op.operationSupplierProcessId,
              tags: op.tags ?? [],
              workInstruction: op.workInstruction,
              companyId,
              createdBy: userId,
              customFields: {},
            });
          });

          if (operationInserts.length > 0) {
            const operationIds = await trx
              .insertInto("methodOperation")
              .values(
                operationInserts.map((insert) => ({
                  ...insert,
                  makeMethodId:
                    insert.makeMethodId ===
                    makeMethodByItemId[jobMakeMethod.data.itemId]
                      ? makeMethod.data.id
                      : insert.makeMethodId,
                }))
              )
              .returning(["id"])
              .execute();

            for (const [index, operation] of (
              jobOperations.data ?? []
            ).entries()) {
              const operationId = operationIds[index].id;
              if (operationId) {
                const { jobOperationTool } = operation;
                if (
                  Array.isArray(jobOperationTool) &&
                  jobOperationTool.length > 0
                ) {
                  await trx
                    .insertInto("methodOperationTool")
                    .values(
                      jobOperationTool.map((tool) => ({
                        toolId: tool.toolId,
                        quantity: tool.quantity,
                        operationId,
                        companyId,
                        createdBy: userId,
                      }))
                    )
                    .execute();
                }
              }
            }
          }
        });

        break;
      }
      case "quoteLineToItem": {
        const [quoteId, quoteLineId] = (sourceId as string).split(":");
        if (!quoteId || !quoteLineId) {
          throw new Error("Invalid sourceId");
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
              .select(
                "*, quoteOperationTool(id, operationId, toolId, quantity, createdBy, createdAt, updatedBy, updatedAt)"
              )
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

        await traverseQuoteMethod(
          quoteMethodTree,
          (node: QuoteMethodTreeItem) => {
            if (node.data.itemId && node.data.methodType === "Make") {
              madeItemIds.push(node.data.itemId);
            }
          }
        );

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

          await traverseQuoteMethod(
            quoteMethodTree,
            (node: QuoteMethodTreeItem) => {
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
            }
          );

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
                  productionQuantity: undefined,
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
              operationType: op.operationType ?? "Inside",
              operationSupplierProcessId: op.operationSupplierProcessId,
              tags: op.tags ?? [],
              workInstruction: op.workInstruction,
              companyId,
              createdBy: userId,
              customFields: {},
            });
          });

          if (operationInserts.length > 0) {
            const operationIds = await trx
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
              .returning(["id"])
              .execute();

            for (const [index, operation] of (
              quoteOperations.data ?? []
            ).entries()) {
              const operationId = operationIds[index].id;
              if (operationId) {
                const { quoteOperationTool } = operation;
                if (
                  Array.isArray(quoteOperationTool) &&
                  quoteOperationTool.length > 0
                ) {
                  await trx
                    .insertInto("methodOperationTool")
                    .values(
                      quoteOperationTool.map((tool) => ({
                        toolId: tool.toolId,
                        quantity: tool.quantity,
                        operationId,
                        companyId,
                        createdBy: userId,
                      }))
                    )
                    .execute();
                }
              }
            }
          }
        });

        break;
      }
      case "quoteLineToJob": {
        const jobId = targetId;
        if (!jobId) {
          throw new Error("Invalid targetId");
        }

        const [quoteId, quoteLineId] = (sourceId as string).split(":");
        if (!quoteId || !quoteLineId) {
          throw new Error("Invalid sourceId");
        }

        const [
          jobMakeMethod,
          quoteMakeMethod,
          quoteMaterials,
          quoteOperations,
        ] = await Promise.all([
          client
            .from("jobMakeMethod")
            .select("*")
            .eq("jobId", jobId)
            .is("parentMaterialId", null)
            .single(),
          client
            .from("quoteMakeMethod")
            .select("*")
            .is("parentMaterialId", null)
            .eq("quoteLineId", quoteLineId)
            .single(),
          client
            .from("quoteMaterial")
            .select("*")
            .eq("quoteLineId", quoteLineId),
          client
            .from("quoteOperation")
            .select(
              "*, quoteOperationTool(id, operationId, toolId, quantity, createdBy, createdAt, updatedBy, updatedAt)"
            )
            .eq("quoteLineId", quoteLineId),
        ]);

        if (jobMakeMethod.error || !jobMakeMethod.data) {
          throw new Error("Failed to get job make method");
        }

        if (
          quoteMakeMethod.error ||
          quoteMaterials.error ||
          quoteOperations.error
        ) {
          throw new Error("Failed to fetch quote data");
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

        const quoteMaterialIdToJobMaterialId: Record<string, string> = {};
        const quoteMakeMethodIdToJobMakeMethodId: Record<string, string> = {};

        await db.transaction().execute(async (trx) => {
          // Delete existing jobMakeMethods, jobMaterials, and jobOperations for this job
          await Promise.all([
            trx
              .deleteFrom("jobMakeMethod")
              .where((eb) =>
                eb.and([
                  eb("jobId", "=", jobId),
                  eb("parentMaterialId", "is not", null),
                ])
              )
              .execute(),
            trx.deleteFrom("jobMaterial").where("jobId", "=", jobId).execute(),
            trx.deleteFrom("jobOperation").where("jobId", "=", jobId).execute(),
          ]);

          await traverseQuoteMethod(
            quoteMethodTree,
            async (node: QuoteMethodTreeItem) => {
              const jobMaterialInserts: Database["public"]["Tables"]["jobMaterial"]["Insert"][] =
                [];
              const jobMakeMethodInserts: Database["public"]["Tables"]["jobMakeMethod"]["Insert"][] =
                [];

              for await (const child of node.children) {
                const newMaterialId = nanoid();
                quoteMaterialIdToJobMaterialId[child.id] = newMaterialId;

                jobMaterialInserts.push({
                  id: newMaterialId,
                  jobId,
                  itemId: child.data.itemId,
                  itemReadableId: child.data.itemReadableId,
                  itemType: child.data.itemType,
                  methodType: child.data.methodType,
                  order: child.data.order,
                  description: child.data.description,
                  jobMakeMethodId:
                    child.data.quoteMakeMethodId === quoteMakeMethod.data.id
                      ? jobMakeMethod.data.id
                      : quoteMakeMethodIdToJobMakeMethodId[
                          child.data.quoteMakeMethodId
                        ],
                  quantity: child.data.quantity,
                  unitOfMeasureCode: child.data.unitOfMeasureCode,
                  companyId,
                  createdBy: userId,
                  customFields: {},
                });

                if (child.data.quoteMaterialMakeMethodId) {
                  const newMakeMethodId = nanoid();
                  quoteMakeMethodIdToJobMakeMethodId[
                    child.data.quoteMaterialMakeMethodId
                  ] = newMakeMethodId;
                  jobMakeMethodInserts.push({
                    id: newMakeMethodId,
                    jobId,
                    parentMaterialId: quoteMaterialIdToJobMaterialId[child.id],
                    itemId: child.data.itemId,
                    quantityPerParent: child.data.quantity,
                    companyId,
                    createdBy: userId,
                  });
                }
              }

              if (jobMaterialInserts.length > 0) {
                await trx
                  .insertInto("jobMaterial")
                  .values(jobMaterialInserts)
                  .execute();
              }

              if (jobMakeMethodInserts.length > 0) {
                for await (const insert of jobMakeMethodInserts) {
                  await trx
                    .updateTable("jobMakeMethod")
                    .set({
                      id: insert.id,
                      quantityPerParent: insert.quantityPerParent,
                    })
                    .where("jobId", "=", jobId)
                    .where("parentMaterialId", "=", insert.parentMaterialId)
                    .execute();
                }
              }
            }
          );

          const jobOperationInserts: Database["public"]["Tables"]["jobOperation"]["Insert"][] =
            quoteOperations.data.map((op) => ({
              jobId,
              jobMakeMethodId:
                op.quoteMakeMethodId === quoteMakeMethod.data.id
                  ? jobMakeMethod.data.id
                  : quoteMakeMethodIdToJobMakeMethodId[op.quoteMakeMethodId!],
              processId: op.processId,
              workCenterId: op.workCenterId,
              description: op.description,
              setupTime: op.setupTime,
              setupUnit: op.setupUnit,
              laborTime: op.laborTime,
              laborUnit: op.laborUnit,
              machineTime: op.machineTime,
              machineUnit: op.machineUnit,
              order: op.order,
              operationOrder: op.operationOrder,
              operationType: op.operationType,
              operationSupplierProcessId: op.operationSupplierProcessId,
              tags: op.tags ?? [],
              workInstruction: op.workInstruction,
              companyId,
              createdBy: userId,
              customFields: {},
            }));

          if (jobOperationInserts.length > 0) {
            const operationIds = await trx
              .insertInto("jobOperation")
              .values(jobOperationInserts)
              .returning(["id"])
              .execute();

            for (const [index, operation] of (
              quoteOperations.data ?? []
            ).entries()) {
              const operationId = operationIds[index].id;
              if (operationId) {
                const { quoteOperationTool } = operation;
                if (
                  Array.isArray(quoteOperationTool) &&
                  quoteOperationTool.length > 0
                ) {
                  await trx
                    .insertInto("jobOperationTool")
                    .values(
                      quoteOperationTool.map((tool) => ({
                        toolId: tool.toolId,
                        quantity: tool.quantity,
                        operationId,
                        companyId,
                        createdBy: userId,
                      }))
                    )
                    .execute();
                }
              }
            }
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

        const [quoteOperations] = await Promise.all([
          client
            .from("quoteOperationsWithMakeMethods")
            .select(
              "*, quoteOperationTool(id, operationId, toolId, quantity, createdBy, createdAt, updatedBy, updatedAt)"
            )
            .eq("quoteLineId", quoteMakeMethod.data.quoteLineId),
        ]);

        if (quoteOperations.error) {
          throw new Error("Failed to get quote operations");
        }

        const [quoteMethodTrees] = await Promise.all([
          getQuoteMethodTree(
            client,
            quoteMakeMethodId,
            quoteMakeMethod.data.parentMaterialId
          ),
        ]);

        if (quoteMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        if (quoteMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const quoteMethodTree = quoteMethodTrees
          .data?.[0] as QuoteMethodTreeItem;
        if (!quoteMethodTree) throw new Error("Job method tree not found");

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

          await traverseQuoteMethod(
            quoteMethodTree!,
            (node: QuoteMethodTreeItem) => {
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
            }
          );

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
                  productionQuantity: undefined,
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
              operationType: op.operationType ?? "Inside",
              tags: op.tags ?? [],
              workInstruction: op.workInstruction,
              companyId,
              createdBy: userId,
              customFields: {},
            });
          });

          if (operationInserts.length > 0) {
            const operationIds = await trx
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
              .returning(["id"])
              .execute();

            for (const [index, operation] of (
              quoteOperations.data ?? []
            ).entries()) {
              const operationId = operationIds[index].id;
              if (operationId) {
                const { quoteOperationTool } = operation;
                if (
                  Array.isArray(quoteOperationTool) &&
                  quoteOperationTool.length > 0
                ) {
                  await trx
                    .insertInto("methodOperationTool")
                    .values(
                      quoteOperationTool.map((tool) => ({
                        toolId: tool.toolId,
                        quantity: tool.quantity,
                        operationId,
                        companyId,
                        createdBy: userId,
                      }))
                    )
                    .execute();
                }
              }
            }
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

function getFieldKey(field: string, id: string) {
  return `${field}:${id}`;
}
