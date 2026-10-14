// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import { insertRows, many, maybeSingle } from "@carbon/database/rows";
import { getLogger } from "@carbon/logger";
import { datetime, getReadableIdWithRevision } from "@carbon/utils";
import type { Transaction } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError } from "../errors";

const logger = getLogger("server-functions", "sync");

const onShapeDataValidator = z.object({
  index: z.string(),
  id: z.string().optional(),
  readableId: z.string().optional(),
  revision: z.string().optional(),
  name: z.string(),
  quantity: z.number(),
  replenishmentSystem: z.enum(["Make", "Buy", "Buy and Make"]),
  defaultMethodType: z.enum([
    "Make to Order",
    "Purchase to Order",
    "Pull from Inventory"
  ]),
  data: z.record(z.string(), z.any())
});

export const syncInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("onshape"),
    makeMethodId: z.string(),
    data: onShapeDataValidator.array()
  })
]);

interface MakeMethodInfo {
  id: string;
  itemId: string;
  version: number;
  status: "Draft" | "Active" | "Archived";
}

async function copyMakeMethodOperations(
  trx: Transaction<KyselyDatabase>,
  sourceMakeMethodId: string,
  targetMakeMethodId: string,
  companyId: string,
  userId: string
) {
  // Fetch source operations
  const sourceOperations = await trx
    .selectFrom("methodOperation")
    .selectAll()
    .where("makeMethodId", "=", sourceMakeMethodId)
    .where("companyId", "=", companyId)
    .execute();

  if (sourceOperations.length === 0) return;

  // Insert operations and copy related records
  for (const operation of sourceOperations) {
    const {
      id: oldOpId,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      updatedBy: _updatedBy,
      ...opData
    } = operation;

    const newOperation = await trx
      .insertInto("methodOperation")
      .values({
        ...opData,
        makeMethodId: targetMakeMethodId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirst();

    if (!newOperation) continue;

    // Copy tools
    const tools = await trx
      .selectFrom("methodOperationTool")
      .selectAll()
      .where("operationId", "=", oldOpId)
      .execute();

    if (tools.length > 0) {
      await trx
        .insertInto("methodOperationTool")
        .values(
          tools.map(
            ({
              id: _id,
              createdAt: _createdAt,
              updatedAt: _updatedAt,
              updatedBy: _updatedBy,
              ...tool
            }) => ({
              ...tool,
              operationId: newOperation.id,
              createdBy: userId
            })
          )
        )
        .execute();
    }

    // Copy parameters
    const parameters = await trx
      .selectFrom("methodOperationParameter")
      .selectAll()
      .where("operationId", "=", oldOpId)
      .execute();

    if (parameters.length > 0) {
      await trx
        .insertInto("methodOperationParameter")
        .values(
          parameters.map(
            ({
              id: _id,
              createdAt: _createdAt,
              updatedAt: _updatedAt,
              updatedBy: _updatedBy,
              ...param
            }) => ({
              ...param,
              operationId: newOperation.id,
              createdBy: userId
            })
          )
        )
        .execute();
    }

    // Copy steps
    const steps = await trx
      .selectFrom("methodOperationStep")
      .selectAll()
      .where("operationId", "=", oldOpId)
      .execute();

    if (steps.length > 0) {
      await trx
        .insertInto("methodOperationStep")
        .values(
          steps.map(
            ({
              id: _id,
              createdAt: _createdAt,
              updatedAt: _updatedAt,
              updatedBy: _updatedBy,
              ...step
            }) => ({
              ...step,
              operationId: newOperation.id,
              createdBy: userId
            })
          )
        )
        .execute();
    }
  }
}

/** Syncs an external CAD structure (Onshape) into a make method's BOM, per `type`. */
const sync = defineServerFn({
  name: "sync",
  input: syncInput,
  permissions: { update: "resources" },
  async run(ctx, payload) {
    const { db, companyId, userId } = ctx;

    switch (payload.type) {
      case "onshape": {
        const { type, makeMethodId, data } = payload;

        logger.info({ type, makeMethodId, data, companyId, userId });

        // Check if top-level make method is Active and find or create a Draft
        const topLevelMakeMethod = await maybeSingle(
          db,
          "makeMethod",
          { id: makeMethodId, companyId },
          { columns: ["id", "itemId", "version", "status"] }
        );

        // Service-role client: a make method outside companyId is a 404.
        if (!topLevelMakeMethod.data) {
          throw new NotFoundError("Make method not found");
        }

        const existingItemIds = new Set(
          data.map((item) => item.id).filter((id): id is string => Boolean(id))
        );

        const existingItems = await many(
          db,
          "item",
          { companyId, id: Array.from(existingItemIds) },
          {
            columns: [
              "id",
              "readableId",
              "readableIdWithRevision",
              "unitOfMeasureCode",
              "type",
              "revision"
            ]
          }
        );
        if (existingItems.error) throw new Error("Failed to fetch items");

        const existingItemsByItemId = new Map(
          existingItems.data?.map((item) => [item.id, item]) ?? []
        );

        // Every item id in the body is updated by id alone below, so each must
        // have come back from the companyId-scoped read above. Checked before
        // anything is written (the Draft make method below).
        for (const itemId of existingItemIds) {
          if (!existingItemsByItemId.has(itemId as string)) {
            throw new NotFoundError("Item not found");
          }
        }

        let activeMakeMethodId = makeMethodId;
        let topLevelSourceMakeMethodId: string | null = null;

        if (topLevelMakeMethod.data?.status === "Active") {
          // Check if there's already a Draft version we can use
          const existingDraft = await maybeSingle(
            db,
            "makeMethod",
            {
              itemId: topLevelMakeMethod.data.itemId,
              status: "Draft",
              companyId
            },
            {
              columns: ["id", "version"],
              orderBy: [{ desc: "version" }],
              limit: 1
            }
          );

          if (existingDraft.data) {
            // Use the existing Draft
            activeMakeMethodId = existingDraft.data.id;
          } else {
            // Get max version across ALL make methods for this item
            const allVersions = await maybeSingle(
              db,
              "makeMethod",
              { itemId: topLevelMakeMethod.data.itemId, companyId },
              { columns: ["version"], orderBy: [{ desc: "version" }], limit: 1 }
            );

            const maxVersion = Number(allVersions.data?.version ?? 0);
            const newVersion = maxVersion + 1;

            logger.info({
              action: "creating_top_level_draft",
              itemId: topLevelMakeMethod.data.itemId,
              maxVersion,
              newVersion
            });

            const newTopLevelMakeMethod = await insertRows(db, "makeMethod", {
              itemId: topLevelMakeMethod.data.itemId,
              version: newVersion,
              status: "Draft",
              companyId,
              createdBy: userId
            });

            const inserted = newTopLevelMakeMethod.data[0];
            if (inserted) {
              activeMakeMethodId = inserted.id;
              topLevelSourceMakeMethodId = makeMethodId;
            }
          }
        }

        // Read after the Draft above may have been created, as before.
        const existingMakeMethods = await many(
          db,
          "activeMakeMethods",
          { companyId, itemId: Array.from(existingItemIds) },
          { columns: ["id", "itemId", "version", "status"] }
        );
        if (existingMakeMethods.error) {
          throw new Error("Failed to fetch make methods");
        }

        logger.info({
          action: "fetched_active_make_methods",
          count: existingMakeMethods.data?.length ?? 0,
          data: existingMakeMethods.data
        });

        const existingMakeMethodsByItemId = new Map<string, MakeMethodInfo>(
          existingMakeMethods.data?.map((makeMethod) => [
            makeMethod.itemId!,
            {
              id: makeMethod.id!,
              itemId: makeMethod.itemId!,
              version: Number(makeMethod.version),
              status: makeMethod.status as "Draft" | "Active" | "Archived"
            }
          ]) ?? []
        );

        {
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
            for (
              let i = 0;
              i < Math.min(aIndices.length, bIndices.length);
              i++
            ) {
              const aVal = parseInt(aIndices[i]!);
              const bVal = parseInt(bIndices[i]!);
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
                level: indexStr.split(".").length
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

          await db
            .transaction()
            .execute(async (trx: Transaction<KyselyDatabase>) => {
              // If we created a new draft for the top-level, copy operations from the active version
              if (topLevelSourceMakeMethodId) {
                await copyMakeMethodOperations(
                  trx,
                  topLevelSourceMakeMethodId,
                  activeMakeMethodId,
                  companyId,
                  userId
                );
              }

              await trx
                .deleteFrom("methodMaterial")
                .where("makeMethodId", "=", activeMakeMethodId)
                .where("companyId", "=", companyId)
                .execute();

              // Track newly created items and make methods to avoid duplicate inserts
              const newlyCreatedItemsByPartId = new Map<string, string>();
              const newlyCreatedMakeMethodsByItemId = new Map<
                string,
                MakeMethodInfo
              >();

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
                  defaultMethodType
                } = data;

                const partId = readableId || name;
                if (!partId) return;

                const externalPartId = getReadableIdWithRevision(
                  partId,
                  revision
                );

                const isMade = children.length > 0;
                let itemId = id;

                if (itemId) {
                  // Update existing item
                  await trx
                    .updateTable("item")
                    .set({
                      updatedBy: userId,
                      updatedAt: datetime.timestamp()
                    })
                    .where("id", "=", itemId)
                    .where("companyId", "=", companyId)
                    .execute();

                  await trx
                    .deleteFrom("externalIntegrationMapping")
                    .where("entityType", "=", "item")
                    .where("entityId", "=", itemId)
                    .where("integration", "=", "onshapeData")
                    .where("companyId", "=", companyId)
                    .execute();

                  await trx
                    .insertInto("externalIntegrationMapping")
                    .values({
                      entityType: "item",
                      entityId: itemId,
                      integration: "onshapeData",
                      externalId: externalPartId,
                      metadata: data.data,
                      companyId,
                      allowDuplicateExternalId: false
                    })
                    .onConflict((oc) =>
                      oc
                        .columns([
                          "integration",
                          "externalId",
                          "entityType",
                          "companyId"
                        ])
                        .where("allowDuplicateExternalId", "=", false)
                        .doUpdateSet({
                          entityId: itemId,
                          metadata: data.data,
                          updatedAt: datetime.timestamp()
                        })
                    )
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
                        createdBy: userId
                      })
                      .returning(["id"])
                      .executeTakeFirst();

                    itemId = item?.id;

                    // Create OnShape mapping for the new item
                    if (itemId) {
                      await trx
                        .insertInto("externalIntegrationMapping")
                        .values({
                          entityType: "item",
                          entityId: itemId,
                          integration: "onshapeData",
                          externalId: externalPartId,
                          metadata: data.data,
                          companyId,
                          allowDuplicateExternalId: false
                        })
                        .onConflict((oc) =>
                          oc
                            .columns([
                              "integration",
                              "externalId",
                              "entityType",
                              "companyId"
                            ])
                            .where("allowDuplicateExternalId", "=", false)
                            .doUpdateSet({
                              entityId: itemId,
                              metadata: data.data,
                              updatedAt: datetime.timestamp()
                            })
                        )
                        .execute();
                    }

                    await trx
                      .insertInto("part")
                      .values({
                        id: partId,
                        companyId,
                        createdBy: userId
                      })
                      .onConflict((oc) =>
                        oc.columns(["id", "companyId"]).doUpdateSet({
                          updatedBy: userId,
                          updatedAt: datetime.timestamp()
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
                        type: "Part"
                      });
                    }
                  }
                }

                if (!itemId) throw new Error("Failed to create item");

                let materialMakeMethodId: string | undefined;
                const existingMakeMethod =
                  existingMakeMethodsByItemId.get(itemId) ||
                  newlyCreatedMakeMethodsByItemId.get(itemId);

                logger.info({
                  action: "processing_item",
                  itemId,
                  partId,
                  isMade,
                  defaultMethodType,
                  existingMakeMethod: existingMakeMethod ?? null
                });

                if (defaultMethodType === "Make to Order" || isMade) {
                  if (existingMakeMethod) {
                    if (existingMakeMethod.status === "Draft") {
                      // Draft - use existing make method directly
                      materialMakeMethodId = existingMakeMethod.id;
                    } else {
                      // Active - check if there's already a Draft we can use
                      const existingDraft = await trx
                        .selectFrom("makeMethod")
                        .select(["id", "version"])
                        .where("itemId", "=", itemId)
                        .where("status", "=", "Draft")
                        .where("companyId", "=", companyId)
                        .orderBy("version", "desc")
                        .executeTakeFirst();

                      logger.info({
                        action: "check_existing_draft",
                        itemId,
                        companyId,
                        existingDraft: existingDraft ?? null
                      });

                      if (existingDraft) {
                        // Use the existing Draft
                        materialMakeMethodId = existingDraft.id;
                        const makeMethodInfo: MakeMethodInfo = {
                          id: existingDraft.id,
                          itemId,
                          version: Number(existingDraft.version),
                          status: "Draft"
                        };
                        newlyCreatedMakeMethodsByItemId.set(
                          itemId,
                          makeMethodInfo
                        );
                        existingMakeMethodsByItemId.set(itemId, makeMethodInfo);
                      } else {
                        // Get max version across ALL make methods for this item
                        const maxVersionRow = await trx
                          .selectFrom("makeMethod")
                          .select(["version"])
                          .where("itemId", "=", itemId)
                          .where("companyId", "=", companyId)
                          .orderBy("version", "desc")
                          .executeTakeFirst();

                        const maxVersion = Number(maxVersionRow?.version ?? 0);
                        const newVersion = maxVersion + 1;

                        logger.info({
                          action: "creating_child_draft",
                          itemId,
                          companyId,
                          maxVersionRow: maxVersionRow ?? null,
                          maxVersion,
                          newVersion
                        });

                        const newMakeMethod = await trx
                          .insertInto("makeMethod")
                          .values({
                            itemId,
                            version: newVersion,
                            status: "Draft",
                            companyId,
                            createdBy: userId
                          })
                          .returning(["id"])
                          .executeTakeFirst();

                        if (newMakeMethod) {
                          materialMakeMethodId = newMakeMethod.id;

                          // Copy operations from active version to new draft
                          await copyMakeMethodOperations(
                            trx,
                            existingMakeMethod.id,
                            newMakeMethod.id,
                            companyId,
                            userId
                          );

                          // Update tracking maps
                          const newMakeMethodInfo: MakeMethodInfo = {
                            id: newMakeMethod.id,
                            itemId,
                            version: newVersion,
                            status: "Draft"
                          };
                          newlyCreatedMakeMethodsByItemId.set(
                            itemId,
                            newMakeMethodInfo
                          );
                          existingMakeMethodsByItemId.set(
                            itemId,
                            newMakeMethodInfo
                          );
                        }
                      }
                    }
                  } else {
                    // No existing make method - check if trigger created one, or create new
                    const triggerCreatedMakeMethod = await trx
                      .selectFrom("makeMethod")
                      .select(["id", "version", "status"])
                      .where("itemId", "=", itemId)
                      .executeTakeFirst();

                    if (triggerCreatedMakeMethod) {
                      materialMakeMethodId = triggerCreatedMakeMethod.id;
                      const makeMethodInfo: MakeMethodInfo = {
                        id: triggerCreatedMakeMethod.id,
                        itemId,
                        version: Number(triggerCreatedMakeMethod.version),
                        status: triggerCreatedMakeMethod.status as
                          | "Draft"
                          | "Active"
                          | "Archived"
                      };
                      newlyCreatedMakeMethodsByItemId.set(
                        itemId,
                        makeMethodInfo
                      );
                      existingMakeMethodsByItemId.set(itemId, makeMethodInfo);
                    } else {
                      // Create a new make method if needed
                      const newMakeMethod = await trx
                        .insertInto("makeMethod")
                        .values({
                          itemId,
                          companyId,
                          createdBy: userId
                        })
                        .returning(["id"])
                        .executeTakeFirst();

                      materialMakeMethodId = newMakeMethod?.id;

                      if (materialMakeMethodId) {
                        const makeMethodInfo: MakeMethodInfo = {
                          id: materialMakeMethodId,
                          itemId,
                          version: 1,
                          status: "Draft"
                        };
                        newlyCreatedMakeMethodsByItemId.set(
                          itemId,
                          makeMethodInfo
                        );
                        existingMakeMethodsByItemId.set(itemId, makeMethodInfo);
                      }
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
                      existingItemsByItemId.get(itemId)?.unitOfMeasureCode ??
                      "EA",
                    companyId,
                    createdBy: userId
                  })
                  .execute();

                if (materialMakeMethodId) {
                  await trx
                    .deleteFrom("methodMaterial")
                    .where("makeMethodId", "=", materialMakeMethodId)
                    .where("companyId", "=", companyId)
                    .execute();

                  for await (const child of children) {
                    const childIndex = children.indexOf(child);
                    await traverseTree(child, materialMakeMethodId, childIndex);
                  }
                }
              }

              let index = 0;
              for await (const node of tree) {
                await traverseTree(node, activeMakeMethodId, index);
                index++;
              }
            });
        }

        return {
          success: true,
          makeMethodId: activeMakeMethodId
        };
      }
    }
  }
});

export default sync;
