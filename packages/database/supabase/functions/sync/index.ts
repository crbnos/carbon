import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { Transaction } from "npm:kysely";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import z from "npm:zod@^3.24.1";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { requirePermissions } from "../lib/supabase.ts";
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
  defaultMethodType: z.enum(["Make to Order", "Purchase to Order", "Pull from Inventory"]),
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

interface MakeMethodInfo {
  id: string;
  itemId: string;
  version: number;
  status: "Draft" | "Active" | "Archived";
}

async function copyMakeMethodOperations(
  trx: Transaction<DB>,
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
        createdBy: userId,
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
              createdBy: userId,
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
              createdBy: userId,
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
              createdBy: userId,
            })
          )
        )
        .execute();
    }
  }
}

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;
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

      const client = await requirePermissions(req, companyId, userId, { update: "resources" });

      // Check if top-level make method is Active and find or create a Draft
      const topLevelMakeMethod = await client
        .from("makeMethod")
        .select("id, itemId, version, status")
        .eq("id", makeMethodId)
        .single();

      let activeMakeMethodId = makeMethodId;
      let topLevelSourceMakeMethodId: string | null = null;

      if (topLevelMakeMethod.data?.status === "Active") {
        // Check if there's already a Draft version we can use
        const existingDraft = await client
          .from("makeMethod")
          .select("id, version")
          .eq("itemId", topLevelMakeMethod.data.itemId)
          .eq("status", "Draft")
          .eq("companyId", companyId)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingDraft.data) {
          // Use the existing Draft
          activeMakeMethodId = existingDraft.data.id;
        } else {
          // Get max version across ALL make methods for this item
          const allVersions = await client
            .from("makeMethod")
            .select("version")
            .eq("itemId", topLevelMakeMethod.data.itemId)
            .eq("companyId", companyId)
            .order("version", { ascending: false })
            .limit(1)
            .maybeSingle();

          const maxVersion = Number(allVersions.data?.version ?? 0);
          const newVersion = maxVersion + 1;

          console.log({
            function: "sync",
            action: "creating_top_level_draft",
            itemId: topLevelMakeMethod.data.itemId,
            maxVersion,
            newVersion,
          });

          const newTopLevelMakeMethod = await client
            .from("makeMethod")
            .insert({
              itemId: topLevelMakeMethod.data.itemId,
              version: newVersion,
              status: "Draft",
              companyId,
              createdBy: userId,
            })
            .select("id")
            .single();

          if (newTopLevelMakeMethod.data) {
            activeMakeMethodId = newTopLevelMakeMethod.data.id;
            topLevelSourceMakeMethodId = makeMethodId;
          }
        }
      }

      const existingItemIds = new Set(
        data.map((item: { id?: string }) => item.id).filter(Boolean)
      );

      const [existingMakeMethods, existingItems] = await Promise.all([
        client
          .from("activeMakeMethods")
          .select("id, itemId, version, status")
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

      console.log({
        function: "sync",
        action: "fetched_active_make_methods",
        count: existingMakeMethods.data?.length ?? 0,
        data: existingMakeMethods.data,
      });

      const existingMakeMethodsByItemId = new Map<string, MakeMethodInfo>(
        existingMakeMethods.data?.map((makeMethod) => [
          makeMethod.itemId!,
          {
            id: makeMethod.id!,
            itemId: makeMethod.itemId!,
            version: Number(makeMethod.version),
            status: makeMethod.status as "Draft" | "Active" | "Archived",
          },
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

        await db.transaction().execute(async (trx: Transaction<DB>) => {
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
              revision: rawRevision,
              name,
              quantity,
              replenishmentSystem,
              defaultMethodType,
            } = data;

            const partId = readableId || name;
            if (!partId) return;

            // Onshape sends "" (not undefined) for rows without a released
            // revision — normalize to the canonical initial revision so
            // item.revision is never stored as "".
            const revision = rawRevision?.trim() ? rawRevision.trim() : "0";
            const onshapeDescription =
              typeof data.data?.Description === "string" &&
              data.data.Description.trim().length > 0
                ? (data.data.Description as string).trim()
                : undefined;

            const externalPartId = getReadableIdWithRevision(partId, revision);

            const isMade = children.length > 0;
            let itemId = id;

            if (itemId) {
              // Update existing item with the Onshape-owned fields. Carbon-owned
              // fields (tracking type, replenishment, UoM) are deliberately left
              // alone — the user may have changed them after the first import.
              await trx
                .updateTable("item")
                .set({
                  ...(name ? { name } : {}),
                  ...(onshapeDescription
                    ? { description: onshapeDescription }
                    : {}),
                  updatedBy: userId,
                  updatedAt: new Date().toISOString(),
                })
                .where("id", "=", itemId)
                .execute();

              await trx
                .deleteFrom("externalIntegrationMapping")
                .where("entityType", "=", "item")
                .where("entityId", "=", itemId)
                .where("integration", "=", "onshapeData")
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
                  allowDuplicateExternalId: false,
                })
                .onConflict((oc) =>
                  oc
                    .columns([
                      "integration",
                      "externalId",
                      "entityType",
                      "companyId",
                    ])
                    .where("allowDuplicateExternalId", "=", false)
                    .doUpdateSet({
                      entityId: itemId,
                      metadata: data.data,
                      updatedAt: new Date().toISOString(),
                    })
                )
                .execute();
            } else {
              // Check if we've already created this part in this transaction
              itemId = newlyCreatedItemsByPartId.get(partId);

              if (!itemId) {
                // If other revisions of this readableId exist, the new item is
                // a REVISION of that family — start it as a faithful copy of
                // the latest sibling (same field set as items.service.ts
                // createRevision) so the only differences are the ones Onshape
                // actually sent. Prefer named revisions over the initial one,
                // then newest.
                const siblings = await trx
                  .selectFrom("item")
                  .select([
                    "id",
                    "name",
                    "description",
                    "type",
                    "replenishmentSystem",
                    "defaultMethodType",
                    "itemTrackingType",
                    "unitOfMeasureCode",
                    "sourcingType",
                    "thumbnailPath",
                    "mpn",
                    "modelUploadId",
                    "revision",
                    "createdAt",
                  ])
                  .where("companyId", "=", companyId)
                  .where("readableId", "=", partId)
                  .execute();

                const isInitialRevision = (r: string | null) =>
                  !r || r === "0";
                const sourceRevision = [...siblings].sort((a, b) => {
                  const aInitial = isInitialRevision(a.revision) ? 1 : 0;
                  const bInitial = isInitialRevision(b.revision) ? 1 : 0;
                  if (aInitial !== bInitial) return aInitial - bInitial;
                  return String(b.createdAt).localeCompare(String(a.createdAt));
                })[0];

                const itemType = sourceRevision?.type ?? "Part";
                const unitOfMeasureCode =
                  sourceRevision?.unitOfMeasureCode ?? "EA";

                const item = await trx
                  .insertInto("item")
                  .values({
                    readableId: partId,
                    revision,
                    name: name || sourceRevision?.name || partId,
                    type: itemType,
                    unitOfMeasureCode,
                    itemTrackingType:
                      sourceRevision?.itemTrackingType ?? "Inventory",
                    replenishmentSystem:
                      sourceRevision?.replenishmentSystem ??
                      replenishmentSystem,
                    defaultMethodType:
                      sourceRevision?.defaultMethodType ?? defaultMethodType,
                    ...(onshapeDescription ?? sourceRevision?.description
                      ? {
                          description:
                            onshapeDescription ?? sourceRevision?.description,
                        }
                      : {}),
                    ...(sourceRevision?.sourcingType
                      ? { sourcingType: sourceRevision.sourcingType }
                      : {}),
                    ...(sourceRevision?.thumbnailPath
                      ? { thumbnailPath: sourceRevision.thumbnailPath }
                      : {}),
                    ...(sourceRevision?.mpn
                      ? { mpn: sourceRevision.mpn }
                      : {}),
                    ...(sourceRevision?.modelUploadId
                      ? { modelUploadId: sourceRevision.modelUploadId }
                      : {}),
                    companyId,
                    createdBy: userId,
                  })
                  .returning(["id"])
                  .executeTakeFirst();

                itemId = item?.id;

                // A new revision keeps the family's bill of process: copy the
                // sibling's operations onto the make method the item-insert
                // trigger just created (the sync only rebuilds materials).
                if (itemId && sourceRevision) {
                  const targetMakeMethod = await trx
                    .selectFrom("makeMethod")
                    .select(["id"])
                    .where("itemId", "=", itemId)
                    .where("companyId", "=", companyId)
                    .orderBy("version", "desc")
                    .executeTakeFirst();

                  const sourceMakeMethods = await trx
                    .selectFrom("makeMethod")
                    .select(["id", "status", "version"])
                    .where("itemId", "=", sourceRevision.id)
                    .where("companyId", "=", companyId)
                    .where("status", "!=", "Archived")
                    .execute();
                  const sourceMakeMethod = [...sourceMakeMethods].sort(
                    (a, b) => {
                      const aActive = a.status === "Active" ? 0 : 1;
                      const bActive = b.status === "Active" ? 0 : 1;
                      if (aActive !== bActive) return aActive - bActive;
                      return Number(b.version) - Number(a.version);
                    }
                  )[0];

                  if (targetMakeMethod && sourceMakeMethod) {
                    await copyMakeMethodOperations(
                      trx,
                      sourceMakeMethod.id,
                      targetMakeMethod.id,
                      companyId,
                      userId
                    );
                  }
                }

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
                      allowDuplicateExternalId: false,
                    })
                    .onConflict((oc) =>
                      oc
                        .columns([
                          "integration",
                          "externalId",
                          "entityType",
                          "companyId",
                        ])
                        .where("allowDuplicateExternalId", "=", false)
                        .doUpdateSet({
                          entityId: itemId,
                          metadata: data.data,
                          updatedAt: new Date().toISOString(),
                        })
                    )
                    .execute();
                }

                // The type-table row (part/tool/...) is shared by the whole
                // revision family — only Parts are created here, and a family
                // copied from a non-Part sibling already has its type row.
                if (itemType === "Part") {
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
                }

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
                    revision,
                    unitOfMeasureCode,
                    type: itemType,
                  });
                }
              }
            }

            if (!itemId) throw new Error("Failed to create item");

            let materialMakeMethodId: string | undefined;
            const existingMakeMethod =
              existingMakeMethodsByItemId.get(itemId) ||
              newlyCreatedMakeMethodsByItemId.get(itemId);

            console.log({
              function: "sync",
              action: "processing_item",
              itemId,
              partId,
              isMade,
              defaultMethodType,
              existingMakeMethod: existingMakeMethod ?? null,
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

                  console.log({
                    function: "sync",
                    action: "check_existing_draft",
                    itemId,
                    companyId,
                    existingDraft: existingDraft ?? null,
                  });

                  if (existingDraft) {
                    // Use the existing Draft
                    materialMakeMethodId = existingDraft.id;
                    const makeMethodInfo: MakeMethodInfo = {
                      id: existingDraft.id,
                      itemId,
                      version: Number(existingDraft.version),
                      status: "Draft",
                    };
                    newlyCreatedMakeMethodsByItemId.set(itemId, makeMethodInfo);
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

                    console.log({
                      function: "sync",
                      action: "creating_child_draft",
                      itemId,
                      companyId,
                      maxVersionRow: maxVersionRow ?? null,
                      maxVersion,
                      newVersion,
                    });

                    const newMakeMethod = await trx
                      .insertInto("makeMethod")
                      .values({
                        itemId,
                        version: newVersion,
                        status: "Draft",
                        companyId,
                        createdBy: userId,
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
                        status: "Draft",
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
                      | "Archived",
                  };
                  newlyCreatedMakeMethodsByItemId.set(itemId, makeMethodInfo);
                  existingMakeMethodsByItemId.set(itemId, makeMethodInfo);
                } else {
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
                    const makeMethodInfo: MakeMethodInfo = {
                      id: materialMakeMethodId,
                      itemId,
                      version: 1,
                      status: "Draft",
                    };
                    newlyCreatedMakeMethodsByItemId.set(itemId, makeMethodInfo);
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
            await traverseTree(node, activeMakeMethodId, index);
            index++;
          }
        });
      } catch (err) {
        return errorResponse(err, 500);
      }

      return jsonResponse({
        success: true,
        makeMethodId: activeMakeMethodId,
      });
    }
  }
});
