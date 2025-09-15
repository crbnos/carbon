import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { z } from "npm:zod@^3.24.1";

import type {
  PostgrestError,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.33.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import type { Database } from "../lib/types.ts";

import { Transaction } from "https://esm.sh/v135/kysely@0.26.3/dist/cjs/kysely.d.ts";
import {
  getLocalTimeZone,
  now,
  toCalendarDate,
} from "npm:@internationalized/date";
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
import { importTypeScript } from "../lib/sandbox.ee.ts";
import {
  getNextRevisionSequence,
  getNextSequence,
} from "../shared/get-next-sequence.ts";

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
    "makeMethodToMakeMethod",
    "procedureToOperation",
    "quoteLineToItem",
    "quoteLineToJob",
    "quoteLineToQuoteLine",
    "quoteMakeMethodToItem",
    "quoteToQuote",
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
        const [sourceMakeMethod, targetMakeMethod, targetItemReplenishment] =
          await Promise.all([
            client
              .from("activeMakeMethods")
              .select("*")
              .eq("itemId", sourceId)
              .eq("companyId", companyId)
              .single(),
            client
              .from("activeMakeMethods")
              .select("*")
              .eq("itemId", targetId)
              .eq("companyId", companyId)
              .single(),
            client
              .from("itemReplenishment")
              .select("*")
              .eq("itemId", targetId)
              .eq("companyId", companyId)
              .single(),
          ]);
        if (sourceMakeMethod.error || targetMakeMethod.error) {
          throw new Error("Failed to get make methods");
        }

        if (targetItemReplenishment.error) {
          throw new Error("Failed to get target item replenishment");
        }

        if (targetItemReplenishment.data?.requiresConfiguration) {
          throw new Error("Cannot override method of configured item");
        }

        if (
          sourceMakeMethod.data.id === null ||
          targetMakeMethod.data.id === null
        ) {
          throw new Error("Failed to get make methods");
        }

        const [sourceMaterials, sourceOperations] = await Promise.all([
          client
            .from("methodMaterial")
            .select("*")
            .eq("makeMethodId", sourceMakeMethod.data.id)
            .eq("companyId", companyId),
          client
            .from("methodOperation")
            .select(
              "*, methodOperationTool(*), methodOperationParameter(*), methodOperationStep(*)"
            )
            .eq("makeMethodId", sourceMakeMethod.data.id)
            .eq("companyId", companyId),
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
                  makeMethodId: targetMakeMethod.data.id!,
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
                  ({
                    methodOperationTool: _tools,
                    methodOperationParameter: _parameters,
                    methodOperationStep: _attributes,
                    ...operation
                  }) => ({
                    ...operation,
                    id: undefined, // Let the database generate a new ID
                    makeMethodId: targetMakeMethod.data.id!,
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
              const {
                methodOperationTool,
                methodOperationParameter,
                methodOperationStep,
                procedureId,
              } = operation;
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

              if (!procedureId) {
                if (
                  Array.isArray(methodOperationParameter) &&
                  methodOperationParameter.length > 0
                ) {
                  await trx
                    .insertInto("methodOperationParameter")
                    .values(
                      methodOperationParameter.map((param) => ({
                        operationId: operationId!,
                        key: param.key,
                        value: param.value,
                        companyId,
                        createdBy: userId,
                      }))
                    )
                    .execute();
                }

                if (
                  Array.isArray(methodOperationStep) &&
                  methodOperationStep.length > 0
                ) {
                  await trx
                    .insertInto("methodOperationStep")
                    .values(
                      methodOperationStep.map(({ id: _id, ...attribute }) => ({
                        ...attribute,
                        operationId: operationId!,
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
      case "itemToJob": {
        const jobId = targetId;
        if (!jobId) {
          throw new Error("Invalid targetId");
        }
        const itemId = sourceId;
        const isConfigured = !!configuration;

        const [makeMethod, jobMakeMethod, workCenters, supplierProcesses] =
          await Promise.all([
            client
              .from("activeMakeMethods")
              .select("*")
              .eq("itemId", itemId)
              .eq("companyId", companyId)
              .single(),
            client
              .from("jobMakeMethod")
              .select("*")
              .eq("jobId", jobId)
              .is("parentMaterialId", null)
              .eq("companyId", companyId)
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

        const hydratedConfiguration = await hydrateConfiguration(
          client,
          configuration,
          itemId,
          companyId
        );

        const [methodTrees, configurationRules] = await Promise.all([
          getMethodTree(client, makeMethod.data.id!),
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
            trx
              .updateTable("jobMakeMethod")
              .set({ version: makeMethod.data.version ?? 1 })
              .where("id", "=", jobMakeMethod.data.id!)
              .execute(),
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
            if (!configurationCodeByField) return defaultValue;
            const fieldKey = getFieldKey(field, id);

            if (configurationCodeByField?.[fieldKey]) {
              try {
                const mod = await importTypeScript(
                  configurationCodeByField[fieldKey]
                );
                const result = await mod.configure(hydratedConfiguration);
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
                "*, methodOperationTool(*), methodOperationParameter(*), methodOperationStep(*)"
              )
              .eq("makeMethodId", node.data.materialMakeMethodId);

            let jobOperationsInserts: Database["public"]["Tables"]["jobOperation"]["Insert"][] =
              [];
            for await (const op of relatedOperations?.data ?? []) {
              const [
                processId,
                procedureId,
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
                  field: "procedureId",
                  defaultValue: op.procedureId,
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
                procedureId,
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
              bopConfiguration = await mod.configure(hydratedConfiguration);
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
                  const {
                    methodOperationTool,
                    methodOperationParameter,
                    methodOperationStep,
                    procedureId,
                  } = operation;

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

                  if (procedureId) {
                    await insertProcedureDataForJobOperation(trx, client, {
                      operationId,
                      procedureId,
                      companyId,
                      userId,
                    });
                  } else {
                    if (
                      Array.isArray(methodOperationParameter) &&
                      methodOperationParameter.length > 0
                    ) {
                      const parameters = await Promise.all(
                        methodOperationParameter.map(async (param) => ({
                          operationId,
                          key: param.key,
                          value: await getConfiguredValue({
                            id: operation.id,
                            field: `parameter:${param.id}:value`,
                            defaultValue: param.value,
                          }),
                          companyId,
                          createdBy: userId,
                        }))
                      );

                      await trx
                        .insertInto("jobOperationParameter")
                        .values(parameters)
                        .execute();
                    }

                    if (
                      Array.isArray(methodOperationStep) &&
                      methodOperationStep.length > 0
                    ) {
                      const attributes = await Promise.all(
                        methodOperationStep.map(
                          async ({ id: _id, ...attribute }) => ({
                            ...attribute,
                            operationId,
                            minValue: await getConfiguredValue({
                              id: operation.id,
                              field: `attribute:${_id}:minValue`,
                              defaultValue: attribute.minValue,
                            }),
                            maxValue: await getConfiguredValue({
                              id: operation.id,
                              field: `attribute:${_id}:maxValue`,
                              defaultValue: attribute.maxValue,
                            }),
                            companyId,
                            createdBy: userId,
                          })
                        )
                      );

                      await trx
                        .insertInto("jobOperationStep")
                        .values(attributes)
                        .execute();
                    }
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

              let itemType = child.data.itemType;
              let unitCost = child.data.unitCost;
              let requiresSerialTracking =
                child.data.itemTrackingType === "Serial";
              let requiresBatchTracking =
                child.data.itemTrackingType === "Batch";

              if (itemId !== child.data.itemId) {
                const item = await client
                  .from("item")
                  .select(
                    "readableId, readableIdWithRevision, type, name, itemTrackingType, itemCost(unitCost)"
                  )
                  .eq("id", itemId)
                  .eq("companyId", companyId)
                  .single();
                if (item.data) {
                  itemType = item.data.type;
                  unitCost =
                    item.data.itemCost[0]?.unitCost ?? child.data.unitCost;
                  if (description === child.data.description) {
                    description = item.data.name;
                  }
                  requiresSerialTracking =
                    item.data.itemTrackingType === "Serial";
                  requiresBatchTracking =
                    item.data.itemTrackingType === "Batch";
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
                itemType,
                kit: child.data.kit,
                methodType,
                order: child.data.order,
                description,
                quantity,
                requiresSerialTracking,
                requiresBatchTracking,
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
              bomConfiguration = await mod.configure(hydratedConfiguration);
            }

            if (bomConfiguration) {
              // @ts-expect-error - we can't assign undefined to materialsWithConfiguredFields but we filter them in the next step
              materialsWithConfiguredFields = bomConfiguration
                .map((readableIdWithRevision, index) => {
                  const material = materialsWithConfiguredFields.find(
                    (material) => material.itemId === itemId
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
                (m) => m.itemId === material.itemId
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
                .select(["id", "parentMaterialId"])
                .where(
                  "parentMaterialId",
                  "in",
                  madeMaterialIds.map((m) => m.id)
                )
                .execute();

              // Create proper mapping from parentMaterialId to jobMakeMethodId
              const materialIdToJobMakeMethodId: Record<string, string> = {};
              jobMakeMethods.forEach((jmm) => {
                if (jmm.parentMaterialId && jmm.id) {
                  materialIdToJobMakeMethodId[jmm.parentMaterialId] = jmm.id;
                }
              });

              // Use proper correlation instead of index-based assumption
              for (const [index, child] of madeChildren.entries()) {
                const materialId = madeMaterialIds[index]?.id;
                const jobMakeMethodId = materialId
                  ? materialIdToJobMakeMethodId[materialId]
                  : null;

                // prevent an infinite loop
                if (child.data.itemId !== itemId && jobMakeMethodId) {
                  await traverseMethod(child, jobMakeMethodId);
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
        const isConfigured = !!configuration;

        const [makeMethod, jobMakeMethod, workCenters, supplierProcesses] =
          await Promise.all([
            client
              .from("activeMakeMethods")
              .select("*")
              .eq("itemId", itemId)
              .eq("companyId", companyId)
              .single(),
            client
              .from("jobMakeMethod")
              .select("*")
              .eq("id", jobMakeMethodId)
              .eq("companyId", companyId)
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

        const hydratedConfiguration = await hydrateConfiguration(
          client,
          configuration,
          itemId,
          companyId
        );

        const [methodTrees, configurationRules] = await Promise.all([
          getMethodTree(client, makeMethod.data.id!),
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
            trx
              .updateTable("jobMakeMethod")
              .set({ version: makeMethod.data.version ?? 1 })
              .where("id", "=", jobMakeMethodId)
              .execute(),
          ]);

          function getFieldKey(field: string, id: string) {
            return `${field}:${id}`;
          }

          async function getConfiguredValue<T>({
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

            if (configurationCodeByField?.[fieldKey]) {
              try {
                const mod = await importTypeScript(
                  configurationCodeByField[fieldKey]
                );
                const result = await mod.configure(hydratedConfiguration);
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
            const relatedOperations = await client
              .from("methodOperation")
              .select(
                "*, methodOperationTool(*), methodOperationParameter(*), methodOperationStep(*)"
              )
              .eq("makeMethodId", node.data.materialMakeMethodId);

            const jobOperationsInserts =
              relatedOperations?.data?.map((op) => ({
                jobId: jobMakeMethod.data?.jobId!,
                jobMakeMethodId: parentJobMakeMethodId!,
                processId: op.processId,
                procedureId: op.procedureId,
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
                operationUnitCost: op.operationUnitCost ?? 0,
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
                  const {
                    methodOperationTool,
                    methodOperationParameter,
                    methodOperationStep,
                    procedureId,
                  } = operation;

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

                  if (procedureId) {
                    await insertProcedureDataForJobOperation(trx, client, {
                      operationId,
                      procedureId,
                      companyId,
                      userId,
                    });
                  } else {
                    if (
                      Array.isArray(methodOperationParameter) &&
                      methodOperationParameter.length > 0
                    ) {
                      await trx
                        .insertInto("jobOperationParameter")
                        .values(
                          methodOperationParameter.map((param) => ({
                            operationId,
                            key: param.key,
                            value: param.value,
                            companyId,
                            createdBy: userId,
                          }))
                        )
                        .execute();
                    }

                    if (
                      Array.isArray(methodOperationStep) &&
                      methodOperationStep.length > 0
                    ) {
                      await trx
                        .insertInto("jobOperationStep")
                        .values(
                          methodOperationStep.map(
                            ({ id: _id, ...attribute }) => ({
                              ...attribute,
                              operationId,
                              companyId,
                              createdBy: userId,
                            })
                          )
                        )
                        .execute();
                    }
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
              kit: child.data.kit,
              itemType: child.data.itemType,
              methodType: child.data.methodType,
              order: child.data.order,
              description: child.data.description,
              quantity: child.data.quantity,
              requiresBatchTracking: child.data.itemTrackingType === "Batch",
              requiresSerialTracking: child.data.itemTrackingType === "Serial",
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
                .select(["id", "parentMaterialId"])
                .where(
                  "parentMaterialId",
                  "in",
                  madeMaterialIds.map((m) => m.id)
                )
                .execute();

              // Create proper mapping from parentMaterialId to jobMakeMethodId
              const materialIdToJobMakeMethodId: Record<string, string> = {};
              jobMakeMethods.forEach((jmm) => {
                if (jmm.parentMaterialId && jmm.id) {
                  materialIdToJobMakeMethodId[jmm.parentMaterialId] = jmm.id;
                }
              });

              // Use proper correlation instead of index-based assumption
              for (const [index, child] of madeChildren.entries()) {
                const materialId = madeMaterialIds[index]?.id;
                const jobMakeMethodId = materialId
                  ? materialIdToJobMakeMethodId[materialId]
                  : null;

                // prevent an infinite loop
                if (child.data.itemId !== itemId && jobMakeMethodId) {
                  await traverseMethod(child, jobMakeMethodId);
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
          client
            .from("activeMakeMethods")
            .select("*")
            .eq("itemId", itemId)
            .eq("companyId", companyId)
            .single(),
          client
            .from("quoteMakeMethod")
            .select("*")
            .eq("quoteLineId", quoteLineId)
            .is("parentMaterialId", null)
            .eq("companyId", companyId)
            .single(),
          client.from("workCenters").select("*").eq("companyId", companyId),
          client.from("supplierProcess").select("*").eq("companyId", companyId),
          isConfigured
            ? client
                .from("configurationRule")
                .select("field, code")
                .eq("itemId", itemId)
                .eq("companyId", companyId)
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

        const hydratedConfiguration = await hydrateConfiguration(
          client,
          configuration,
          itemId,
          companyId
        );

        const [methodTrees] = await Promise.all([
          getMethodTree(client, makeMethod.data.id!),
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
            trx
              .updateTable("quoteMakeMethod")
              .set({ version: makeMethod.data.version ?? 1 })
              .where("id", "=", quoteMakeMethod.data.id!)
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
                const result = await mod.configure(hydratedConfiguration);

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
                "*, methodOperationTool(*), methodOperationParameter(*), methodOperationStep(*)"
              )
              .eq("makeMethodId", node.data.materialMakeMethodId);

            let quoteOperationsInserts: Database["public"]["Tables"]["quoteOperation"]["Insert"][] =
              [];
            for await (const op of relatedOperations?.data ?? []) {
              const [
                processId,
                procedureId,
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
                  field: "procedureId",
                  defaultValue: op.procedureId,
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

              const operationRates = getLaborAndOverheadRates(
                processId,
                op.workCenterId
              );
              console.log({
                processId,
                ...operationRates,
              });

              quoteOperationsInserts.push({
                quoteId,
                quoteLineId,
                quoteMakeMethodId: parentQuoteMakeMethodId!,
                processId,
                procedureId,
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
                operationUnitCost: op.operationUnitCost ?? 0,
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
              bopConfiguration = await mod.configure(hydratedConfiguration);
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
                  const {
                    methodOperationTool,
                    methodOperationParameter,
                    methodOperationStep,
                    procedureId,
                  } = operation;

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

                  if (!procedureId) {
                    if (
                      Array.isArray(methodOperationParameter) &&
                      methodOperationParameter.length > 0
                    ) {
                      const parameters = await Promise.all(
                        methodOperationParameter.map(async (param) => ({
                          operationId,
                          key: param.key,
                          value: await getConfiguredValue({
                            id: operation.id,
                            field: `parameter:${param.id}:value`,
                            defaultValue: param.value,
                          }),
                          companyId,
                          createdBy: userId,
                        }))
                      );

                      await trx
                        .insertInto("quoteOperationParameter")
                        .values(parameters)
                        .execute();
                    }

                    if (
                      Array.isArray(methodOperationStep) &&
                      methodOperationStep.length > 0
                    ) {
                      const attributes = await Promise.all(
                        methodOperationStep.map(
                          async ({ id, ...attribute }) => ({
                            ...attribute,
                            operationId,
                            minValue: await getConfiguredValue({
                              id: operation.id,
                              field: `attribute:${id}:minValue`,
                              defaultValue: attribute.minValue,
                            }),
                            maxValue: await getConfiguredValue({
                              id: operation.id,
                              field: `attribute:${id}:maxValue`,
                              defaultValue: attribute.maxValue,
                            }),
                            companyId,
                            createdBy: userId,
                          })
                        )
                      );

                      await trx
                        .insertInto("quoteOperationStep")
                        .values(attributes)
                        .execute();
                    }
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

              let itemType = child.data.itemType;
              let unitCost = child.data.unitCost;

              // TODO: if the methodType is Make and the default value is not Make, we need to do itemToQuoteMakeMethod for that material

              if (itemId !== child.data.itemId) {
                const item = await client
                  .from("item")
                  .select(
                    "readableIdWithRevision, readableId, type, name, itemCost(unitCost)"
                  )
                  .eq("id", itemId)
                  .eq("companyId", companyId)
                  .single();
                if (item.data) {
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
                itemType,
                kit: child.data.kit,
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
              bomConfiguration = await mod.configure(hydratedConfiguration);
            }

            if (bomConfiguration) {
              // @ts-expect-error - we can't assign undefined to materialsWithConfiguredFields but we filter them in the next step
              materialsWithConfiguredFields = bomConfiguration
                .map((readableIdWithRevision, index) => {
                  const material = materialsWithConfiguredFields.find(
                    (material) => material.itemId === itemId
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
                (m) => m.itemId === material.itemId
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
                .select(["id", "parentMaterialId"])
                .where(
                  "parentMaterialId",
                  "in",
                  madeMaterialIds.map((m) => m.id)
                )
                .execute();

              // Create proper mapping from parentMaterialId to quoteMakeMethodId
              const materialIdToQuoteMakeMethodId: Record<string, string> = {};
              quoteMakeMethods.forEach((qmm) => {
                if (qmm.parentMaterialId && qmm.id) {
                  materialIdToQuoteMakeMethodId[qmm.parentMaterialId] = qmm.id;
                }
              });

              // Use proper correlation instead of index-based assumption
              for (const [index, child] of madeChildren.entries()) {
                const materialId = madeMaterialIds[index]?.id;
                const quoteMakeMethodId = materialId
                  ? materialIdToQuoteMakeMethodId[materialId]
                  : null;

                // prevent an infinite loop
                if (child.data.itemId !== itemId && quoteMakeMethodId) {
                  await traverseMethod(child, quoteMakeMethodId);
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
        const isConfigured = !!configuration;

        const [makeMethod, quoteMakeMethod, workCenters, supplierProcesses] =
          await Promise.all([
            client
              .from("activeMakeMethods")
              .select("*")
              .eq("itemId", itemId)
              .eq("companyId", companyId)
              .single(),
            client
              .from("quoteMakeMethod")
              .select("*")
              .eq("id", quoteMakeMethodId)
              .eq("companyId", companyId)
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

        const hydratedConfiguration = await hydrateConfiguration(
          client,
          configuration,
          itemId,
          companyId
        );

        const [methodTrees, configurationRules] = await Promise.all([
          getMethodTree(client, makeMethod.data.id!),
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
            trx
              .updateTable("quoteMakeMethod")
              .set({ version: makeMethod.data.version ?? 1 })
              .where("id", "=", quoteMakeMethodId)
              .execute(),
          ]);

          function getFieldKey(field: string, id: string) {
            return `${field}:${id}`;
          }

          async function getConfiguredValue<T>({
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

            if (configurationCodeByField?.[fieldKey]) {
              try {
                const mod = await importTypeScript(
                  configurationCodeByField[fieldKey]
                );
                const result = await mod.configure(hydratedConfiguration);
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
                "*, methodOperationTool(*), methodOperationParameter(*), methodOperationStep(*)"
              )
              .eq("makeMethodId", node.data.materialMakeMethodId);

            const quoteOperationInserts =
              relatedOperations?.data?.map((op) => ({
                quoteId: quoteMakeMethod.data?.quoteId!,
                quoteLineId: quoteMakeMethod.data?.quoteLineId!,
                quoteMakeMethodId: parentQuoteMakeMethodId!,
                processId: op.processId,
                procedureId: op.procedureId,
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
                operationUnitCost: op.operationUnitCost ?? 0,
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
                  const {
                    methodOperationTool,
                    methodOperationParameter,
                    methodOperationStep,
                    procedureId,
                  } = operation;

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

                  if (!procedureId) {
                    if (
                      Array.isArray(methodOperationParameter) &&
                      methodOperationParameter.length > 0
                    ) {
                      await trx
                        .insertInto("quoteOperationParameter")
                        .values(
                          methodOperationParameter.map((param) => ({
                            operationId,
                            key: param.key,
                            value: param.value,
                            companyId,
                            createdBy: userId,
                          }))
                        )
                        .execute();
                    }

                    if (
                      Array.isArray(methodOperationStep) &&
                      methodOperationStep.length > 0
                    ) {
                      await trx
                        .insertInto("quoteOperationStep")
                        .values(
                          methodOperationStep.map(
                            ({ id: _id, ...attribute }) => ({
                              ...attribute,
                              operationId,
                              companyId,
                              createdBy: userId,
                            })
                          )
                        )
                        .execute();
                    }
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
              itemType: child.data.itemType,
              kit: child.data.kit,
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
                .select(["id", "parentMaterialId"])
                .where(
                  "parentMaterialId",
                  "in",
                  madeMaterialIds.map((m) => m.id)
                )
                .execute();

              // Create proper mapping from parentMaterialId to quoteMakeMethodId
              const materialIdToQuoteMakeMethodId: Record<string, string> = {};
              quoteMakeMethods.forEach((qmm) => {
                if (qmm.parentMaterialId && qmm.id) {
                  materialIdToQuoteMakeMethodId[qmm.parentMaterialId] = qmm.id;
                }
              });

              // Use proper correlation instead of index-based assumption
              for (const [index, child] of madeChildren.entries()) {
                const materialId = madeMaterialIds[index]?.id;
                const quoteMakeMethodId = materialId
                  ? materialIdToQuoteMakeMethodId[materialId]
                  : null;

                // prevent an infinite loop
                if (child.data.itemId !== itemId && quoteMakeMethodId) {
                  await traverseMethod(child, quoteMakeMethodId);
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
        const makeMethodId = targetId;

        const [makeMethod, jobMakeMethod] = await Promise.all([
          client
            .from("makeMethod")
            .select("*")
            .eq("id", makeMethodId)
            .eq("companyId", companyId)
            .single(),
          client
            .from("jobMakeMethod")
            .select("*")
            .eq("id", jobMakeMethodId)
            .eq("companyId", companyId)
            .single(),
        ]);

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (jobMakeMethod.error) {
          throw new Error("Failed to get job make method");
        }

        const itemId = makeMethod.data?.itemId;

        const [jobOperations, itemReplenishment] = await Promise.all([
          client
            .from("jobOperationsWithMakeMethods")
            .select(
              "*, jobOperationTool(*), jobOperationParameter(*), jobOperationStep(*)"
            )
            .eq("jobId", jobMakeMethod.data.jobId)
            .eq("companyId", companyId),
          client
            .from("itemReplenishment")
            .select("*")
            .eq("itemId", itemId)
            .eq("companyId", companyId)
            .single(),
        ]);

        if (jobOperations.error) {
          throw new Error("Failed to get job operations");
        }

        if (itemReplenishment.error) {
          throw new Error("Failed to get item replenishment");
        }

        if (itemReplenishment.data?.requiresConfiguration) {
          throw new Error("Cannot override method of configured item");
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
                itemType: child.data.itemType,
                kit: child.data.kit,
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
              procedureId: op.procedureId,
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
              operationMinimumCost: op.operationMinimumCost ?? 0,
              operationLeadTime: op.operationLeadTime ?? 0,
              operationUnitCost: op.operationUnitCost ?? 0,
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
                const {
                  jobOperationTool,
                  jobOperationParameter,
                  jobOperationStep,
                  procedureId,
                } = operation;

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

                if (!procedureId) {
                  if (
                    Array.isArray(jobOperationParameter) &&
                    jobOperationParameter.length > 0
                  ) {
                    await trx
                      .insertInto("methodOperationParameter")
                      .values(
                        jobOperationParameter.map((param) => ({
                          operationId,
                          key: param.key,
                          value: param.value,
                          companyId,
                          createdBy: userId,
                        }))
                      )
                      .execute();
                  }

                  if (
                    Array.isArray(jobOperationStep) &&
                    jobOperationStep.length > 0
                  ) {
                    await trx
                      .insertInto("jobOperationStep")
                      .values(
                        jobOperationStep.map(({ id: _id, ...attribute }) => ({
                          ...attribute,
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
          }
        });

        break;
      }
      case "jobToItem": {
        const jobId = sourceId;
        if (!jobId) {
          throw new Error("Invalid sourceId");
        }
        const makeMethodId = targetId;

        const [makeMethod, jobMakeMethod, jobOperations] = await Promise.all([
          client
            .from("makeMethod")
            .select("*")
            .eq("id", makeMethodId)
            .eq("companyId", companyId)
            .single(),
          client
            .from("jobMakeMethod")
            .select("*")
            .eq("jobId", jobId)
            .is("parentMaterialId", null)
            .eq("companyId", companyId)
            .single(),
          client
            .from("jobOperationsWithMakeMethods")
            .select(
              "*, jobOperationTool(*), jobOperationParameter(*), jobOperationStep(*)"
            )
            .eq("jobId", jobId)
            .eq("companyId", companyId),
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

        const itemId = makeMethod.data?.itemId;

        const [jobMethodTrees, itemReplenishment] = await Promise.all([
          getJobMethodTree(client, jobMakeMethod.data.id),
          client
            .from("itemReplenishment")
            .select("*")
            .eq("itemId", itemId)
            .eq("companyId", companyId)
            .single(),
        ]);

        if (itemReplenishment.error) {
          throw new Error("Failed to get item replenishment");
        }

        if (itemReplenishment.data?.requiresConfiguration) {
          throw new Error("Cannot override method of configured item");
        }

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
          .from("activeMakeMethods")
          .select("*")
          .in("itemId", madeItemIds)
          .eq("companyId", companyId);
        if (makeMethods.error) {
          throw new Error("Failed to get make methods");
        }

        const makeMethodByItemId: Record<string, string> = {};
        makeMethods.data?.forEach((m) => {
          if (m.itemId) {
            // @ts-expect-error - itemId is not null
            makeMethodByItemId[m.itemId!] = m.id;
          }
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
                itemType: child.data.itemType,
                kit: child.data.kit,
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
              procedureId: op.procedureId,
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
              operationMinimumCost: op.operationMinimumCost ?? 0,
              operationLeadTime: op.operationLeadTime ?? 0,
              operationUnitCost: op.operationUnitCost ?? 0,
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
                const {
                  jobOperationTool,
                  jobOperationParameter,
                  jobOperationStep,
                  procedureId,
                } = operation;

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

                if (!procedureId) {
                  if (
                    Array.isArray(jobOperationParameter) &&
                    jobOperationParameter.length > 0
                  ) {
                    await trx
                      .insertInto("methodOperationParameter")
                      .values(
                        jobOperationParameter.map((param) => ({
                          operationId,
                          key: param.key,
                          value: param.value,
                          companyId,
                          createdBy: userId,
                        }))
                      )
                      .execute();
                  }

                  if (
                    Array.isArray(jobOperationStep) &&
                    jobOperationStep.length > 0
                  ) {
                    await trx
                      .insertInto("methodOperationStep")
                      .values(
                        jobOperationStep.map(({ id: _id, ...attribute }) => ({
                          ...attribute,
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
          }
        });

        break;
      }
      case "makeMethodToMakeMethod": {
        const [sourceMakeMethod, targetMakeMethod] = await Promise.all([
          client
            .from("makeMethod")
            .select("*")
            .eq("id", sourceId)
            .eq("companyId", companyId)
            .single(),
          client
            .from("makeMethod")
            .select("*")
            .eq("id", targetId)
            .eq("companyId", companyId)
            .single(),
        ]);
        if (sourceMakeMethod.error || targetMakeMethod.error) {
          throw new Error("Failed to get make methods");
        }

        const [sourceMaterials, sourceOperations] = await Promise.all([
          client
            .from("methodMaterial")
            .select("*")
            .eq("makeMethodId", sourceMakeMethod.data.id)
            .eq("companyId", companyId),
          client
            .from("methodOperation")
            .select(
              "*, methodOperationTool(*), methodOperationParameter(*), methodOperationStep(*)"
            )
            .eq("makeMethodId", sourceMakeMethod.data.id)
            .eq("companyId", companyId),
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
                  ({
                    methodOperationTool: _tools,
                    methodOperationParameter: _parameters,
                    methodOperationStep: _attributes,
                    ...operation
                  }) => ({
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
              const {
                methodOperationTool,
                methodOperationParameter,
                methodOperationStep,
                procedureId,
              } = operation;
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

              if (!procedureId) {
                if (
                  Array.isArray(methodOperationParameter) &&
                  methodOperationParameter.length > 0
                ) {
                  await trx
                    .insertInto("methodOperationParameter")
                    .values(
                      methodOperationParameter.map((param) => ({
                        operationId: operationId!,
                        key: param.key,
                        value: param.value,
                        companyId,
                        createdBy: userId,
                      }))
                    )
                    .execute();
                }

                if (
                  Array.isArray(methodOperationStep) &&
                  methodOperationStep.length > 0
                ) {
                  await trx
                    .insertInto("methodOperationStep")
                    .values(
                      methodOperationStep.map(({ id: _id, ...attribute }) => ({
                        ...attribute,
                        operationId: operationId!,
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
      case "procedureToOperation": {
        const procedureId = sourceId;
        const operationId = targetId;
        if (!procedureId) {
          throw new Error("Invalid sourceId");
        }

        if (!operationId) {
          throw new Error("Invalid targetId");
        }

        const [procedure, operation] = await Promise.all([
          client
            .from("procedure")
            .select("*, procedureStep(*), procedureParameter(*)")
            .eq("id", procedureId)
            .eq("companyId", companyId)
            .single(),
          client
            .from("jobOperation")
            .select("*, jobOperationStep(*)")
            .eq("id", operationId)
            .eq("companyId", companyId)
            .single(),
        ]);

        if (procedure.error) {
          throw new Error("Failed to get procedure");
        }

        if (operation.error) {
          throw new Error("Failed to get operation");
        }

        const existingSteps = operation.data?.jobOperationStep ?? [];

        await db.transaction().execute(async (trx) => {
          // Update or delete existing attributes
          for (const existingStep of existingSteps) {
            const matchingProcedureStep = procedure.data.procedureStep.find(
              (pa) =>
                pa.name === existingStep.name && pa.type === existingStep.type
            );

            if (matchingProcedureStep) {
              // Update matching attribute
              await trx
                .updateTable("jobOperationStep")
                .set({
                  description: matchingProcedureStep.description,
                  minValue: matchingProcedureStep.minValue,
                  maxValue: matchingProcedureStep.maxValue,
                  updatedAt: new Date().toISOString(),
                  updatedBy: userId,
                })
                .where("id", "=", existingStep.id)
                .execute();
            } else {
              // Delete non-matching attribute
              await trx
                .deleteFrom("jobOperationStep")
                .where("id", "=", existingStep.id)
                .execute();
            }
          }

          // Delete all existing parameters
          await trx
            .deleteFrom("jobOperationParameter")
            .where("operationId", "=", operationId)
            .execute();

          // Add new attributes that don't exist yet
          const newSteps = procedure.data.procedureStep.filter(
            (pa) =>
              !existingSteps.some(
                (ea) => ea.name === pa.name && ea.type === pa.type
              )
          );

          if (newSteps.length > 0) {
            await trx
              .insertInto("jobOperationStep")
              .values(
                newSteps.map((attr) => ({
                  operationId: operationId,
                  name: attr.name,
                  type: attr.type,
                  description: attr.description,
                  minValue: attr.minValue,
                  maxValue: attr.maxValue,
                  companyId,
                  createdBy: userId,
                  updatedBy: userId,
                }))
              )
              .execute();
          }

          // Add all parameters from procedure
          if (procedure.data.procedureParameter.length > 0) {
            await trx
              .insertInto("jobOperationParameter")
              .values(
                procedure.data.procedureParameter.map((param) => ({
                  operationId: operationId,
                  companyId,
                  key: param.key,
                  value: param.value,
                  createdBy: userId,
                  updatedBy: userId,
                }))
              )
              .execute();
          }

          // update work instruction
          await trx
            .updateTable("jobOperation")
            .set({
              workInstruction: procedure.data.content,
              procedureId: procedureId,
            })
            .where("id", "=", operationId)
            .execute();
        });
        break;
      }
      case "quoteLineToItem": {
        const [quoteId, quoteLineId] = (sourceId as string).split(":");
        if (!quoteId || !quoteLineId) {
          throw new Error("Invalid sourceId");
        }
        const makeMethodId = targetId;

        const [makeMethod, quoteMakeMethod, quoteOperations] =
          await Promise.all([
            client
              .from("makeMethod")
              .select("*")
              .eq("id", makeMethodId)
              .eq("companyId", companyId)
              .single(),
            client
              .from("quoteMakeMethod")
              .select("*")
              .eq("quoteLineId", quoteLineId)
              .is("parentMaterialId", null)
              .eq("companyId", companyId)
              .single(),
            client
              .from("quoteOperationsWithMakeMethods")
              .select(
                "*, quoteOperationTool(*), quoteOperationParameter(*), quoteOperationStep(*)"
              )
              .eq("quoteLineId", quoteLineId)
              .eq("companyId", companyId),
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

        const itemId = makeMethod.data?.itemId;

        const [quoteMethodTrees, itemReplenishment] = await Promise.all([
          getQuoteMethodTree(client, quoteMakeMethod.data.id),
          client
            .from("itemReplenishment")
            .select("*")
            .eq("itemId", itemId)
            .eq("companyId", companyId)
            .single(),
        ]);

        if (quoteMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        if (itemReplenishment.error) {
          throw new Error("Failed to get item replenishment");
        }

        if (itemReplenishment.data?.requiresConfiguration) {
          throw new Error("Cannot override method of configured item");
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
          .from("activeMakeMethods")
          .select("*")
          .in("itemId", madeItemIds)
          .eq("companyId", companyId);
        if (makeMethods.error) {
          throw new Error("Failed to get make methods");
        }

        const makeMethodByItemId: Record<string, string> = {};
        makeMethods.data?.forEach((m) => {
          if (m.itemId) {
            // @ts-expect-error - itemId is not null
            makeMethodByItemId[m.itemId!] = m.id;
          }
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
                  itemType: child.data.itemType,
                  kit: child.data.kit,
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
              procedureId: op.procedureId,
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
              operationMinimumCost: op.operationMinimumCost ?? 0,
              operationLeadTime: op.operationLeadTime ?? 0,
              operationUnitCost: op.operationUnitCost ?? 0,
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
                const {
                  quoteOperationTool,
                  quoteOperationParameter,
                  quoteOperationStep,
                  procedureId,
                } = operation;

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

                if (!procedureId) {
                  if (
                    Array.isArray(quoteOperationParameter) &&
                    quoteOperationParameter.length > 0
                  ) {
                    await trx
                      .insertInto("methodOperationParameter")
                      .values(
                        quoteOperationParameter.map((param) => ({
                          operationId,
                          key: param.key,
                          value: param.value,
                          companyId,
                          createdBy: userId,
                        }))
                      )
                      .execute();
                  }

                  if (
                    Array.isArray(quoteOperationStep) &&
                    quoteOperationStep.length > 0
                  ) {
                    await trx
                      .insertInto("methodOperationStep")
                      .values(
                        quoteOperationStep.map(({ id: _id, ...attribute }) => ({
                          ...attribute,
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
          }
        });

        break;
      }
      case "quoteMakeMethodToItem": {
        const quoteMakeMethodId = sourceId;
        const makeMethodId = targetId;

        const [makeMethod, quoteMakeMethod] = await Promise.all([
          client
            .from("makeMethod")
            .select("*")
            .eq("id", makeMethodId)
            .eq("companyId", companyId)
            .single(),
          client
            .from("quoteMakeMethod")
            .select("*")
            .eq("id", quoteMakeMethodId)
            .eq("companyId", companyId)
            .single(),
        ]);

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (quoteMakeMethod.error) {
          throw new Error("Failed to get quote make method");
        }

        const itemId = makeMethod.data?.itemId;

        const [quoteOperations, itemReplenishment] = await Promise.all([
          client
            .from("quoteOperationsWithMakeMethods")
            .select(
              "*, quoteOperationTool(*), quoteOperationParameter(*), quoteOperationStep(*)"
            )
            .eq("quoteLineId", quoteMakeMethod.data.quoteLineId)
            .eq("companyId", companyId),
          client
            .from("itemReplenishment")
            .select("*")
            .eq("itemId", itemId)
            .eq("companyId", companyId)
            .single(),
        ]);

        if (quoteOperations.error) {
          throw new Error("Failed to get quote operations");
        }

        if (itemReplenishment.error) {
          throw new Error("Failed to get item replenishment");
        }

        if (itemReplenishment.data?.requiresConfiguration) {
          throw new Error("Cannot override method of configured item");
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
          .from("activeMakeMethods")
          .select("*")
          .in("itemId", madeItemIds)
          .eq("companyId", companyId);
        if (makeMethods.error) {
          throw new Error("Failed to get make methods");
        }

        const makeMethodByItemId: Record<string, string> = {};
        makeMethods.data?.forEach((m) => {
          if (m.itemId) {
            // @ts-expect-error - itemId is not null
            makeMethodByItemId[m.itemId!] = m.id;
          }
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
                  kit: child.data.kit,
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
              procedureId: op.procedureId,
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
              operationMinimumCost: op.operationMinimumCost ?? 0,
              operationLeadTime: op.operationLeadTime ?? 0,
              operationUnitCost: op.operationUnitCost ?? 0,
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
                const {
                  quoteOperationTool,
                  quoteOperationParameter,
                  quoteOperationStep,
                  procedureId,
                } = operation;

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

                if (!procedureId) {
                  if (
                    Array.isArray(quoteOperationParameter) &&
                    quoteOperationParameter.length > 0
                  ) {
                    await trx
                      .insertInto("methodOperationParameter")
                      .values(
                        quoteOperationParameter.map((param) => ({
                          operationId,
                          key: param.key,
                          value: param.value,
                          companyId,
                          createdBy: userId,
                        }))
                      )
                      .execute();
                  }

                  if (
                    Array.isArray(quoteOperationStep) &&
                    quoteOperationStep.length > 0
                  ) {
                    await trx
                      .insertInto("methodOperationStep")
                      .values(
                        quoteOperationStep.map(({ id: _id, ...attribute }) => ({
                          ...attribute,
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
            .eq("companyId", companyId)
            .single(),
          client
            .from("quoteMakeMethod")
            .select("*")
            .is("parentMaterialId", null)
            .eq("quoteLineId", quoteLineId)
            .eq("companyId", companyId)
            .single(),
          client
            .from("quoteMaterial")
            .select("*")
            .eq("quoteLineId", quoteLineId)
            .eq("companyId", companyId),
          client
            .from("quoteOperation")
            .select(
              "*, quoteOperationTool(*), quoteOperationParameter(*), quoteOperationStep(*)"
            )
            .eq("quoteLineId", quoteLineId)
            .eq("companyId", companyId),
        ]);

        if (jobMakeMethod.error || !jobMakeMethod.data) {
          throw new Error("Failed to get job make method");
        }

        if (
          quoteMakeMethod.error ||
          quoteMaterials.error ||
          quoteOperations.error
        ) {
          if (quoteMakeMethod.error) {
            console.log("quoteMakeMethodError");
            console.log(quoteMakeMethod.error);
          }
          if (quoteMaterials.error) {
            console.log(quoteMaterials.error);
          }
          if (quoteOperations.error) {
            console.log(quoteOperations.error);
          }
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
                  itemType: child.data.itemType,
                  kit: child.data.kit,
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
                  requiresBatchTracking:
                    child.data.itemTrackingType === "Batch",
                  requiresSerialTracking:
                    child.data.itemTrackingType === "Serial",
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
              procedureId: op.procedureId,
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
              operationMinimumCost: op.operationMinimumCost ?? 0,
              operationLeadTime: op.operationLeadTime ?? 0,
              operationUnitCost: op.operationUnitCost ?? 0,
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
                const {
                  quoteOperationTool,
                  quoteOperationParameter,
                  quoteOperationStep,
                  procedureId,
                } = operation;

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

                if (procedureId) {
                  await insertProcedureDataForJobOperation(trx, client, {
                    operationId,
                    procedureId,
                    companyId,
                    userId,
                  });
                } else {
                  if (
                    Array.isArray(quoteOperationParameter) &&
                    quoteOperationParameter.length > 0
                  ) {
                    await trx
                      .insertInto("jobOperationParameter")
                      .values(
                        quoteOperationParameter.map((param) => ({
                          operationId,
                          key: param.key,
                          value: param.value,
                          companyId,
                          createdBy: userId,
                        }))
                      )
                      .execute();
                  }

                  if (
                    Array.isArray(quoteOperationStep) &&
                    quoteOperationStep.length > 0
                  ) {
                    await trx
                      .insertInto("jobOperationStep")
                      .values(
                        quoteOperationStep.map(({ id: _id, ...attribute }) => ({
                          ...attribute,
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
          }
        });

        break;
      }
      case "quoteLineToQuoteLine": {
        const [, sourceQuoteLineId] = (sourceId as string).split(":");
        const [targetQuoteId, targetQuoteLineId] = (targetId as string).split(
          ":"
        );

        const [
          targetQuoteMakeMethod,
          sourceQuoteMakeMethod,
          sourceQuoteMaterials,
          sourceQuoteOperations,
        ] = await Promise.all([
          client
            .from("quoteMakeMethod")
            .select("*")
            .eq("quoteLineId", targetQuoteLineId)
            .is("parentMaterialId", null)
            .eq("companyId", companyId)
            .single(),
          client
            .from("quoteMakeMethod")
            .select("*")
            .is("parentMaterialId", null)
            .eq("quoteLineId", sourceQuoteLineId)
            .eq("companyId", companyId)
            .single(),
          client
            .from("quoteMaterial")
            .select("*")
            .eq("quoteLineId", sourceQuoteLineId)
            .eq("companyId", companyId),
          client
            .from("quoteOperation")
            .select(
              "*, quoteOperationTool(*), quoteOperationParameter(*), quoteOperationStep(*)"
            )
            .eq("quoteLineId", sourceQuoteLineId)
            .eq("companyId", companyId),
        ]);

        if (targetQuoteMakeMethod.error || !targetQuoteMakeMethod.data) {
          console.error(targetQuoteMakeMethod.error);
          throw new Error("Failed to get target quote make method");
        }

        if (
          sourceQuoteMakeMethod.error ||
          sourceQuoteMaterials.error ||
          sourceQuoteOperations.error
        ) {
          throw new Error("Failed to source quote data");
        }

        const [quoteMethodTrees] = await Promise.all([
          getQuoteMethodTree(client, sourceQuoteMakeMethod.data.id),
        ]);

        if (quoteMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const quoteMethodTree = quoteMethodTrees
          .data?.[0] as QuoteMethodTreeItem;
        if (!quoteMethodTree) throw new Error("Method tree not found");

        const quoteMaterialIdToQuoteMaterialId: Record<string, string> = {};
        const quoteMakeMethodIdToQuoteMakeMethodId: Record<string, string> = {};

        await db.transaction().execute(async (trx) => {
          // Delete existing jobMakeMethods, jobMaterials, and jobOperations for this job
          await Promise.all([
            trx
              .deleteFrom("quoteMakeMethod")
              .where((eb) =>
                eb.and([
                  eb("quoteLineId", "=", targetQuoteLineId),
                  eb("parentMaterialId", "is not", null),
                ])
              )
              .execute(),
            trx
              .deleteFrom("quoteMaterial")
              .where("quoteLineId", "=", targetQuoteLineId)
              .execute(),
            trx
              .deleteFrom("quoteOperation")
              .where("quoteLineId", "=", targetQuoteLineId)
              .execute(),
          ]);

          await traverseQuoteMethod(
            quoteMethodTree,
            async (node: QuoteMethodTreeItem) => {
              const quoteMaterialInserts: Database["public"]["Tables"]["quoteMaterial"]["Insert"][] =
                [];
              const quoteMakeMethodInserts: Database["public"]["Tables"]["quoteMakeMethod"]["Insert"][] =
                [];

              for await (const child of node.children) {
                const newMaterialId = nanoid();
                quoteMaterialIdToQuoteMaterialId[child.id] = newMaterialId;

                quoteMaterialInserts.push({
                  id: newMaterialId,
                  quoteId: targetQuoteId,
                  quoteLineId: targetQuoteLineId,
                  itemId: child.data.itemId,
                  kit: child.data.kit,
                  itemType: child.data.itemType,
                  methodType: child.data.methodType,
                  order: child.data.order,
                  description: child.data.description,
                  quoteMakeMethodId:
                    child.data.quoteMakeMethodId ===
                    sourceQuoteMakeMethod.data.id
                      ? targetQuoteMakeMethod.data.id
                      : quoteMakeMethodIdToQuoteMakeMethodId[
                          child.data.quoteMakeMethodId
                        ],
                  quantity: child.data.quantity,
                  unitOfMeasureCode: child.data.unitOfMeasureCode,
                  unitCost: child.data.unitCost, // TODO: get unit cost
                  companyId,
                  createdBy: userId,
                  customFields: {},
                });

                if (child.data.quoteMaterialMakeMethodId) {
                  const newMakeMethodId = nanoid();
                  quoteMakeMethodIdToQuoteMakeMethodId[
                    child.data.quoteMaterialMakeMethodId
                  ] = newMakeMethodId;
                  quoteMakeMethodInserts.push({
                    id: newMakeMethodId,
                    quoteId: targetQuoteId,
                    quoteLineId: targetQuoteLineId,
                    parentMaterialId:
                      quoteMaterialIdToQuoteMaterialId[child.id],
                    itemId: child.data.itemId,
                    quantityPerParent: child.data.quantity,
                    companyId,
                    createdBy: userId,
                  });
                }
              }

              if (quoteMaterialInserts.length > 0) {
                await trx
                  .insertInto("quoteMaterial")
                  .values(quoteMaterialInserts)
                  .execute();
              }

              if (quoteMakeMethodInserts.length > 0) {
                for await (const insert of quoteMakeMethodInserts) {
                  await trx
                    .updateTable("quoteMakeMethod")
                    .set({
                      id: insert.id,
                      quantityPerParent: insert.quantityPerParent,
                    })
                    .where("quoteLineId", "=", targetQuoteLineId)
                    .where("parentMaterialId", "=", insert.parentMaterialId)
                    .execute();
                }
              }
            }
          );

          const quoteOperationInserts: Database["public"]["Tables"]["quoteOperation"]["Insert"][] =
            sourceQuoteOperations.data.map((op) => ({
              quoteId: targetQuoteId,
              quoteLineId: targetQuoteLineId,
              quoteMakeMethodId:
                op.quoteMakeMethodId === sourceQuoteMakeMethod.data.id
                  ? targetQuoteMakeMethod.data.id
                  : quoteMakeMethodIdToQuoteMakeMethodId[op.quoteMakeMethodId!],
              processId: op.processId,
              procedureId: op.procedureId,
              workCenterId: op.workCenterId,
              description: op.description,
              setupTime: op.setupTime,
              setupUnit: op.setupUnit,
              laborTime: op.laborTime,
              laborUnit: op.laborUnit,
              laborRate: op.laborRate,
              machineTime: op.machineTime,
              machineUnit: op.machineUnit,
              machineRate: op.machineRate,
              order: op.order,
              operationOrder: op.operationOrder,
              operationType: op.operationType,
              operationSupplierProcessId: op.operationSupplierProcessId,
              operationMinimumCost: op.operationMinimumCost ?? 0,
              operationLeadTime: op.operationLeadTime ?? 0,
              operationUnitCost: op.operationUnitCost ?? 0,
              overheadRate: op.overheadRate,
              tags: op.tags ?? [],
              workInstruction: op.workInstruction,
              companyId,
              createdBy: userId,
              customFields: {},
            }));

          if (quoteOperationInserts.length > 0) {
            const operationIds = await trx
              .insertInto("quoteOperation")
              .values(quoteOperationInserts)
              .returning(["id"])
              .execute();

            for (const [index, operation] of (
              sourceQuoteOperations.data ?? []
            ).entries()) {
              const operationId = operationIds[index].id;
              if (operationId) {
                const {
                  quoteOperationTool,
                  quoteOperationParameter,
                  quoteOperationStep,
                } = operation;

                if (
                  Array.isArray(quoteOperationTool) &&
                  quoteOperationTool.length > 0
                ) {
                  await trx
                    .insertInto("quoteOperationTool")
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

                if (
                  Array.isArray(quoteOperationParameter) &&
                  quoteOperationParameter.length > 0
                ) {
                  await trx
                    .insertInto("quoteOperationParameter")
                    .values(
                      quoteOperationParameter.map((param) => ({
                        operationId,
                        key: param.key,
                        value: param.value,
                        companyId,
                        createdBy: userId,
                      }))
                    )
                    .execute();
                }

                if (
                  Array.isArray(quoteOperationStep) &&
                  quoteOperationStep.length > 0
                ) {
                  await trx
                    .insertInto("quoteOperationStep")
                    .values(
                      quoteOperationStep.map(({ id: _id, ...attribute }) => ({
                        ...attribute,
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

      case "quoteToQuote": {
        const sourceQuoteId = sourceId;
        const asRevision = !!targetId;
        let newQuoteId = "";

        const oldLineToNewLineMap: Record<string, string> = {};

        const [
          sourceQuote,
          sourceQuotePayment,
          sourceQuoteShipment,
          sourceQuoteLines,
        ] = await Promise.all([
          client
            .from("quote")
            .select("*")
            .eq("id", sourceQuoteId)
            .eq("companyId", companyId)
            .single(),
          client
            .from("quotePayment")
            .select("*")
            .eq("id", sourceQuoteId)
            .eq("companyId", companyId)
            .single(),
          client
            .from("quoteShipment")
            .select("*")
            .eq("id", sourceQuoteId)
            .eq("companyId", companyId)
            .single(),
          client
            .from("quoteLine")
            .select("*")
            .eq("quoteId", sourceQuoteId)
            .eq("companyId", companyId),
        ]);

        if (sourceQuote.error) {
          throw new Error("Failed to get source quote");
        }

        if (sourceQuotePayment.error) {
          throw new Error("Failed to get source quote payment");
        }

        if (sourceQuoteShipment.error) {
          throw new Error("Failed to get source quote shipment");
        }

        const sourceQuoteLinePricing = await client
          .from("quoteLinePrice")
          .select("*")
          .in("quoteLineId", sourceQuoteLines.data?.map((l) => l.id) ?? []);

        if (sourceQuoteLinePricing.error) {
          throw new Error("Failed to get source quote line pricing");
        }

        await db.transaction().execute(async (trx) => {
          let quoteId: string;
          let revisionId = 0;
          if (asRevision) {
            quoteId = sourceQuote.data?.quoteId ?? "";
            revisionId = await getNextRevisionSequence(
              trx,
              "quote",
              "quoteId",
              quoteId,
              companyId
            );
          } else {
            quoteId = await getNextSequence(trx, "quote", companyId);
          }

          const externalLinkId = await trx
            .insertInto("externalLink")
            .values({
              documentId: quoteId,
              documentType: "Quote",
              companyId,
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();

          let opportunityId: string | undefined = undefined;
          if (asRevision) {
            opportunityId = sourceQuote.data?.opportunityId ?? undefined;
          } else {
            const opportunity = await trx
              .insertInto("opportunity")
              .values({
                companyId,
                customerId: sourceQuote.data?.customerId,
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            opportunityId = opportunity.id;
          }

          const quote = await trx
            .insertInto("quote")
            .values([
              {
                quoteId,
                revisionId,
                customerId: sourceQuote.data?.customerId,
                customerContactId: sourceQuote.data?.customerContactId,
                customerLocationId: sourceQuote.data?.customerLocationId,
                customerReference: sourceQuote.data?.customerReference,
                locationId: sourceQuote.data?.locationId,
                expirationDate: toCalendarDate(
                  now(getLocalTimeZone()).add({ days: 30 })
                ).toString(),
                salesPersonId: sourceQuote.data?.salesPersonId ?? userId,
                status: "Draft",
                externalNotes: sourceQuote.data?.externalNotes,
                internalNotes: sourceQuote.data?.internalNotes,
                currencyCode: sourceQuote.data?.currencyCode,
                exchangeRate: sourceQuote.data?.exchangeRate,
                exchangeRateUpdatedAt: new Date().toISOString(),
                externalLinkId: externalLinkId.id,
                opportunityId,
                companyId,
                createdBy: userId,
              },
            ])
            .returning(["id"])
            .executeTakeFirstOrThrow();

          if (!quote.id) {
            throw new Error("Failed to insert quote");
          }

          newQuoteId = quote.id;

          // Insert quotePayment
          await trx
            .insertInto("quotePayment")
            .values({
              id: quote.id,
              invoiceCustomerId: sourceQuotePayment.data?.invoiceCustomerId,
              invoiceCustomerContactId:
                sourceQuotePayment.data?.invoiceCustomerContactId,
              invoiceCustomerLocationId:
                sourceQuotePayment.data?.invoiceCustomerLocationId,
              paymentTermId: sourceQuotePayment.data?.paymentTermId,
              companyId,
              updatedBy: userId,
            })
            .execute();

          // Insert quoteShipment
          await trx
            .insertInto("quoteShipment")
            .values({
              id: quote.id,
              locationId: sourceQuoteShipment.data?.locationId,
              shippingMethodId: sourceQuoteShipment.data?.shippingMethodId,
              shippingTermId: sourceQuoteShipment.data?.shippingTermId,
              shippingCost: sourceQuoteShipment.data?.shippingCost,
              receiptRequestedDate:
                sourceQuoteShipment.data?.receiptRequestedDate,
              companyId,
              updatedBy: userId,
            })
            .execute();

          for await (const { id, ...line } of sourceQuoteLines.data ?? []) {
            const newLine = await trx
              .insertInto("quoteLine")
              .values({
                ...line,
                quoteId: quote.id,
                companyId,
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            if (!newLine.id) {
              throw new Error("Failed to insert quote line");
            }

            if (line.methodType === "Make") {
              // we only need further processing on make lines
              oldLineToNewLineMap[id] = newLine.id;
            }

            const sourceQuotePricingForLine =
              sourceQuoteLinePricing.data?.filter(
                (l) => l.quoteLineId === id
              ) ?? [];

            if (sourceQuotePricingForLine.length > 0) {
              await trx
                .insertInto("quoteLinePrice")
                .values(
                  sourceQuotePricingForLine.map((l) => ({
                    quoteId: newQuoteId!,
                    quoteLineId: newLine.id!,
                    leadTime: l.leadTime ?? 0,
                    discountPercent: l.discountPercent ?? 0,
                    quantity: l.quantity ?? 0,
                    unitPrice: l.unitPrice ?? 0,
                    shippingCost: l.shippingCost ?? 0,
                    exchangeRate: l.exchangeRate ?? 0,
                    createdBy: userId,
                  }))
                )
                .execute();
            }
          }
        });

        await db.transaction().execute(async (trx) => {
          for await (const [oldLineId, newLineId] of Object.entries(
            oldLineToNewLineMap
          )) {
            const [
              targetQuoteMakeMethod,
              sourceQuoteMakeMethod,
              sourceQuoteMaterials,
              sourceQuoteOperations,
            ] = await Promise.all([
              client
                .from("quoteMakeMethod")
                .select("*")
                .is("parentMaterialId", null)
                .eq("quoteLineId", newLineId)
                .eq("companyId", companyId)
                .single(),
              client
                .from("quoteMakeMethod")
                .select("*")
                .is("parentMaterialId", null)
                .eq("quoteLineId", oldLineId)
                .eq("companyId", companyId)
                .single(),
              client
                .from("quoteMaterial")
                .select("*")
                .eq("quoteLineId", oldLineId)
                .eq("companyId", companyId),
              client
                .from("quoteOperation")
                .select(
                  "*, quoteOperationTool(*), quoteOperationParameter(*), quoteOperationStep(*)"
                )
                .eq("quoteLineId", oldLineId)
                .eq("companyId", companyId),
            ]);

            if (targetQuoteMakeMethod.error) {
              console.error(targetQuoteMakeMethod.error);
              throw new Error("Failed to get target quote make method");
            }

            if (
              sourceQuoteMakeMethod.error ||
              sourceQuoteMaterials.error ||
              sourceQuoteOperations.error
            ) {
              throw new Error("Failed to source quote data");
            }

            const [quoteMethodTrees] = await Promise.all([
              getQuoteMethodTree(client, sourceQuoteMakeMethod.data.id),
            ]);

            if (quoteMethodTrees.error) {
              throw new Error("Failed to get method tree");
            }

            const quoteMethodTree = quoteMethodTrees
              .data?.[0] as QuoteMethodTreeItem;
            if (!quoteMethodTree) throw new Error("Method tree not found");

            const quoteMaterialIdToQuoteMaterialId: Record<string, string> = {};
            const quoteMakeMethodIdToQuoteMakeMethodId: Record<string, string> =
              {};

            await traverseQuoteMethod(
              quoteMethodTree,
              async (node: QuoteMethodTreeItem) => {
                const quoteMaterialInserts: Database["public"]["Tables"]["quoteMaterial"]["Insert"][] =
                  [];
                const quoteMakeMethodInserts: Database["public"]["Tables"]["quoteMakeMethod"]["Insert"][] =
                  [];

                for await (const child of node.children) {
                  const newMaterialId = nanoid();
                  quoteMaterialIdToQuoteMaterialId[child.id] = newMaterialId;

                  quoteMaterialInserts.push({
                    id: newMaterialId,
                    quoteId: newQuoteId,
                    quoteLineId: newLineId,
                    itemId: child.data.itemId,
                    kit: child.data.kit,
                    itemType: child.data.itemType,
                    methodType: child.data.methodType,
                    order: child.data.order,
                    description: child.data.description,
                    quoteMakeMethodId:
                      child.data.quoteMakeMethodId ===
                      sourceQuoteMakeMethod.data.id
                        ? targetQuoteMakeMethod.data.id
                        : quoteMakeMethodIdToQuoteMakeMethodId[
                            child.data.quoteMakeMethodId
                          ],
                    quantity: child.data.quantity,
                    unitCost: child.data.unitCost, // TODO: get unit cost
                    unitOfMeasureCode: child.data.unitOfMeasureCode,
                    companyId,
                    createdBy: userId,
                    customFields: {},
                  });

                  if (child.data.quoteMaterialMakeMethodId) {
                    const newMakeMethodId = nanoid();
                    quoteMakeMethodIdToQuoteMakeMethodId[
                      child.data.quoteMaterialMakeMethodId
                    ] = newMakeMethodId;
                    quoteMakeMethodInserts.push({
                      id: newMakeMethodId,
                      quoteId: newQuoteId,
                      quoteLineId: newLineId,
                      parentMaterialId:
                        quoteMaterialIdToQuoteMaterialId[child.id],
                      itemId: child.data.itemId,
                      quantityPerParent: child.data.quantity,
                      companyId,
                      createdBy: userId,
                    });
                  }
                }

                if (quoteMaterialInserts.length > 0) {
                  await trx
                    .insertInto("quoteMaterial")
                    .values(quoteMaterialInserts)
                    .execute();
                }

                if (quoteMakeMethodInserts.length > 0) {
                  for await (const insert of quoteMakeMethodInserts) {
                    await trx
                      .updateTable("quoteMakeMethod")
                      .set({
                        id: insert.id,
                        quantityPerParent: insert.quantityPerParent,
                      })
                      .where("quoteLineId", "=", newLineId)
                      .where("parentMaterialId", "=", insert.parentMaterialId)
                      .execute();
                  }
                }
              }
            );

            const quoteOperationInserts: Database["public"]["Tables"]["quoteOperation"]["Insert"][] =
              sourceQuoteOperations.data.map((op) => ({
                quoteId: newQuoteId,
                quoteLineId: newLineId,
                quoteMakeMethodId:
                  op.quoteMakeMethodId === sourceQuoteMakeMethod.data.id
                    ? targetQuoteMakeMethod.data.id
                    : quoteMakeMethodIdToQuoteMakeMethodId[
                        op.quoteMakeMethodId!
                      ],
                processId: op.processId,
                procedureId: op.procedureId,
                workCenterId: op.workCenterId,
                description: op.description,
                setupTime: op.setupTime,
                setupUnit: op.setupUnit,
                laborTime: op.laborTime,
                laborUnit: op.laborUnit,
                laborRate: op.laborRate,
                machineTime: op.machineTime,
                machineUnit: op.machineUnit,
                machineRate: op.machineRate,
                order: op.order,
                operationOrder: op.operationOrder,
                operationType: op.operationType,
                operationSupplierProcessId: op.operationSupplierProcessId,
                operationMinimumCost: op.operationMinimumCost ?? 0,
                operationLeadTime: op.operationLeadTime ?? 0,
                operationUnitCost: op.operationUnitCost ?? 0,
                overheadRate: op.overheadRate,
                tags: op.tags ?? [],
                workInstruction: op.workInstruction,
                companyId,
                createdBy: userId,
                customFields: {},
              }));

            if (quoteOperationInserts.length > 0) {
              const operationIds = await trx
                .insertInto("quoteOperation")
                .values(quoteOperationInserts)
                .returning(["id"])
                .execute();

              for (const [index, operation] of (
                sourceQuoteOperations.data ?? []
              ).entries()) {
                const operationId = operationIds[index].id;
                if (operationId) {
                  const {
                    quoteOperationTool,
                    quoteOperationParameter,
                    quoteOperationStep,
                  } = operation;

                  if (
                    Array.isArray(quoteOperationTool) &&
                    quoteOperationTool.length > 0
                  ) {
                    await trx
                      .insertInto("quoteOperationTool")
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

                  if (
                    Array.isArray(quoteOperationParameter) &&
                    quoteOperationParameter.length > 0
                  ) {
                    await trx
                      .insertInto("quoteOperationParameter")
                      .values(
                        quoteOperationParameter.map((param) => ({
                          operationId,
                          key: param.key,
                          value: param.value,
                          companyId,
                          createdBy: userId,
                        }))
                      )
                      .execute();
                  }

                  if (
                    Array.isArray(quoteOperationStep) &&
                    quoteOperationStep.length > 0
                  ) {
                    await trx
                      .insertInto("quoteOperationStep")
                      .values(
                        quoteOperationStep.map(({ id: _id, ...attribute }) => ({
                          ...attribute,
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
          }
        });
        if (newQuoteId) {
          return new Response(
            JSON.stringify({
              success: true,
              newQuoteId,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 200,
            }
          );
        }
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

async function insertProcedureDataForJobOperation(
  trx: Transaction<DB>,
  client: SupabaseClient<Database>,
  args: {
    operationId: string;
    procedureId: string;
    companyId: string;
    userId: string;
  }
) {
  const { operationId, procedureId, companyId, userId } = args;
  const procedure = await client
    .from("procedure")
    .select("*, procedureStep(*), procedureParameter(*)")
    .eq("id", procedureId)
    .eq("companyId", companyId)
    .single();

  if (procedure.error) return;

  const attributes = procedure.data?.procedureStep ?? [];
  const parameters = procedure.data?.procedureParameter ?? [];

  if (attributes.length > 0) {
    await trx
      .insertInto("jobOperationStep")
      .values(
        attributes.map((attr) => {
          const {
            id: _id,
            procedureId: _procedureId,
            createdAt: _createdAt,
            ...rest
          } = attr;
          return {
            ...rest,
            operationId,
            companyId,
            createdBy: userId,
          };
        })
      )
      .execute();
  }

  if (parameters.length > 0) {
    await trx
      .insertInto("jobOperationParameter")
      .values(
        parameters.map((param) => {
          const {
            id: _id,
            procedureId: _procedureId,
            createdAt: _createdAt,
            ...rest
          } = param;
          return {
            ...rest,
            operationId,
            companyId,
            createdBy: userId,
          };
        })
      )
      .execute();
  }

  await trx
    .updateTable("jobOperation")
    .set({
      workInstruction: procedure?.data?.content ?? {},
    })
    .where("id", "=", operationId)
    .execute();
}

async function hydrateConfiguration(
  client: SupabaseClient<Database>,
  configuration: Record<string, unknown> | undefined,
  itemId: string | undefined | null,
  companyId: string
): Promise<Record<string, unknown> | undefined> {
  try {
    if (!configuration || !itemId || Object.keys(configuration).length === 0) {
      return configuration;
    }

    const materialParams = await client
      .from("configurationParameter")
      .select("key")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .eq("dataType", "material");

    if (materialParams.error) return configuration;

    const materialKeys = new Set((materialParams.data ?? []).map((p) => p.key));

    if (materialKeys.size === 0) return configuration;

    const entries = Object.entries(configuration).filter(
      ([key, value]) =>
        materialKeys.has(key) && typeof value === "string" && value
    );

    if (entries.length === 0) return configuration;

    const itemIds = entries.map(([, value]) => value as string);

    // Get items that correspond to the item IDs
    const items = await client
      .from("item")
      .select("id, readableId")
      .in("id", itemIds)
      .eq("companyId", companyId);

    if (items.error) return configuration;

    // Create map of itemId to readableId (which is the materialId)
    const itemIdToMaterialId = new Map(
      items.data?.map((i) => [i.id, i.readableId]) ?? []
    );

    const materialIds = items.data?.map((i) => i.readableId) ?? [];

    // Get material details using the readableIds (which are the material IDs)
    const materials = await client
      .from("material")
      .select(
        "id, materialFormId, materialSubstanceId, materialTypeId, dimensionId, finishId, gradeId"
      )
      .in("id", materialIds)
      .eq("companyId", companyId);

    if (materials.error) return configuration;

    const materialsByMaterialId = new Map(
      materials.data?.map((m) => [m.id, m]) ?? []
    );

    const transformed: Record<string, unknown> = { ...configuration };

    for (const [key, value] of entries) {
      const itemId = value as string;
      const materialId = itemIdToMaterialId.get(itemId);

      if (materialId) {
        const material = materialsByMaterialId.get(materialId);
        if (material) {
          transformed[key] = {
            id: itemId,
            materialFormId: material.materialFormId ?? null,
            materialSubstanceId: material.materialSubstanceId ?? null,
            materialTypeId: material.materialTypeId ?? null,
            dimensionId: material.dimensionId ?? null,
            finishId: material.finishId ?? null,
            gradeId: material.gradeId ?? null,
          };
        }
      }
    }

    return transformed;
  } catch (err) {
    console.error(err);
    return configuration;
  }
}
