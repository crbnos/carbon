import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { getMaterialDescription, getMaterialId } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import type { InventoryItemType } from "~/modules/items";

import { cascadeItemTrackingType } from "~/modules/items/items.service";
import { getCompanySettings } from "~/modules/settings";
import { getDatabaseClient } from "~/services/database.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const items = formData.getAll("items");
  const field = formData.get("field");
  const value = formData.get("value");

  if (typeof field !== "string" || typeof value !== "string") {
    return { error: { message: "Invalid form data" }, data: null };
  }

  switch (field) {
    case "itemTrackingType": {
      const newType = value as InventoryItemType;

      const result = await client
        .from("item")
        .update({
          itemTrackingType: newType,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", items as string[])
        .eq("companyId", companyId);

      if (result.error) return result;

      try {
        await cascadeItemTrackingType(getDatabaseClient(), {
          itemIds: items as string[],
          companyId,
          newType,
          userId
        });
      } catch (err) {
        console.error(err);
        return {
          error: { message: "Failed to cascade tracking flags" },
          data: null
        };
      }

      return result;
    }
    case "defaultMethodType":
    case "name":
    case "replenishmentSystem":
    case "unitOfMeasureCode":
      if (field === "replenishmentSystem" && value !== "Buy and Make") {
        return await client
          .from("item")
          .update({
            // @ts-expect-error
            [field]: value,
            defaultMethodType:
              value === "Make"
                ? "Make to Order"
                : value === "Buy"
                  ? "Purchase to Order"
                  : "Pull from Inventory",
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .in("id", items as string[])
          .eq("companyId", companyId);
      }
      if (field === "defaultMethodType" && value !== "Pull from Inventory") {
        return await client
          .from("item")
          .update({
            // @ts-expect-error - value is a valid method type
            defaultMethodType: value,
            replenishmentSystem:
              value === "Make to Order"
                ? "Make"
                : value === "Purchase to Order"
                  ? "Buy"
                  : "Buy and Make",
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .in("id", items as string[])
          .eq("companyId", companyId);
      }
      return await client
        .from("item")
        .update({
          [field]: value,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", items as string[])
        .eq("companyId", companyId);
    case "gradeId":
    case "dimensionId":
    case "finishId":
    case "materialFormId":
    case "materialSubstanceId":
    case "materialTypeId":
      const settings = await getCompanySettings(client, companyId);

      if (settings.data?.materialGeneratedIds) {
        let name = "";
        let code = "";
        if (field === "materialSubstanceId") {
          const materialSubstance = await client
            .from("materialSubstance")
            .select("name, code")
            .eq("id", value)
            .single();
          name = materialSubstance.data?.name ?? "";
          code = materialSubstance.data?.code ?? "";
        }
        if (field === "materialFormId") {
          const materialForm = await client
            .from("materialForm")
            .select("name, code")
            .eq("id", value)
            .single();
          name = materialForm.data?.name ?? "";
          code = materialForm.data?.code ?? "";
        }
        if (field === "materialTypeId") {
          const materialType = await client
            .from("materialType")
            .select("name, code")
            .eq("id", value)
            .single();
          name = materialType.data?.name ?? "";
          code = materialType.data?.code ?? "";
        }
        if (field === "finishId") {
          const finish = await client
            .from("materialFinish")
            .select("name")
            .eq("id", value)
            .single();
          name = finish.data?.name ?? "";
        }
        if (field === "gradeId") {
          const grade = await client
            .from("materialGrade")
            .select("name")
            .eq("id", value)
            .single();

          name = grade.data?.name ?? "";
        }
        if (field === "dimensionId") {
          const dimension = await client
            .from("materialDimension")
            .select("name")
            .eq("id", value)
            .single();
          name = dimension.data?.name ?? "";
        }

        for await (const id of items as string[]) {
          const item = await client
            .from("item")
            .select("readableId")
            .eq("id", id)
            .eq("companyId", companyId)
            .single();

          const readableId = item.data?.readableId;

          if (readableId) {
            const [materialDetails, relatedItems] = await Promise.all([
              client
                .rpc("get_material_naming_details", { readable_id: readableId })
                .single(),
              client
                .from("item")
                .select("id")
                .eq("readableId", readableId)
                .eq("companyId", companyId)
            ]);

            if (materialDetails.data) {
              const namingDetails = materialDetails.data;

              if (field === "materialSubstanceId") {
                namingDetails.substance = name;
                namingDetails.substanceCode = code;
              }
              if (field === "materialFormId") {
                namingDetails.shape = name;
                namingDetails.shapeCode = code;
              }
              if (field === "materialTypeId") {
                namingDetails.materialType = name;
                namingDetails.materialTypeCode = code;
              }
              if (field === "finishId") {
                namingDetails.finish = name;
              }
              if (field === "gradeId") {
                namingDetails.grade = name;
              }
              if (field === "dimensionId") {
                namingDetails.dimensions = name;
              }

              const newMaterialId = getMaterialId(namingDetails);
              const newDescription = getMaterialDescription(namingDetails);

              const relatedItemIds = relatedItems.data?.map((item) => item.id);

              if (relatedItemIds) {
                const itemUpdateResult = await client
                  .from("item")
                  .update({ readableId: newMaterialId, name: newDescription })
                  .in("id", relatedItemIds as string[])
                  .eq("companyId", companyId);

                if (itemUpdateResult.error) {
                  return itemUpdateResult;
                }
              }

              let updateData: Database["public"]["Tables"]["material"]["Update"] =
                {
                  [field]: value || null,
                  id: newMaterialId,
                  updatedBy: userId,
                  updatedAt: new Date().toISOString()
                };

              // If substance changes, reset finishId, gradeId, and materialTypeId
              if (field === "materialSubstanceId") {
                updateData.finishId = null;
                updateData.gradeId = null;
                updateData.materialTypeId = null;
              }

              // If form changes, reset dimensionId and materialTypeId
              if (field === "materialFormId") {
                updateData.dimensionId = null;
                updateData.materialTypeId = null;
              }

              const update = await client
                .from("material")
                .update(updateData)
                .eq("id", readableId)
                .eq("companyId", companyId);

              if (update.error) {
                return {
                  error: { message: update.error.message },
                  data: null
                };
              }
            }
          }
        }

        return {
          data: null,
          error: null
        };
      } else {
        const materialItems = await client
          .from("item")
          .select("readableId")
          .in("id", items as string[])
          .eq("companyId", companyId);
        const materialIds = [
          ...new Set(materialItems.data?.map((item) => item.readableId) ?? [])
        ];
        if (materialIds.length === 0) {
          return { error: { message: "No materials found" }, data: null };
        }

        let updateData: Database["public"]["Tables"]["material"]["Update"] = {
          [field]: value || null,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        };

        // If substance changes, reset finishId, gradeId, and materialTypeId
        if (field === "materialSubstanceId") {
          updateData.finishId = null;
          updateData.gradeId = null;
          updateData.materialTypeId = null;
        }

        // If form changes, reset dimensionId and materialTypeId
        if (field === "materialFormId") {
          updateData.dimensionId = null;
          updateData.materialTypeId = null;
        }

        return await client
          .from("material")
          .update(updateData)
          .in("id", materialIds as string[])
          .eq("companyId", companyId);
      }
    case "active":
      return await client
        .from("item")
        .update({
          active: value === "on",
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", items as string[])
        .eq("companyId", companyId);

    case "requiresInspection":
      return await client
        .from("item")
        .update({
          requiresInspection: value === "on",
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", items as string[])
        .eq("companyId", companyId);

    case "itemPostingGroupId":
      // Update itemCost table for all selected items
      const itemCostUpdates = await Promise.all(
        (items as string[]).map(async (itemId) => {
          const existingCost = await client
            .from("itemCost")
            .select("itemId")
            .eq("itemId", itemId)
            .single();

          if (existingCost.data) {
            // Update existing record
            return client
              .from("itemCost")
              .update({
                itemPostingGroupId: value || null,
                updatedBy: userId,
                updatedAt: new Date().toISOString()
              })
              .eq("itemId", itemId);
          } else {
            // Create new record
            return client.from("itemCost").insert({
              itemId,
              itemPostingGroupId: value || null,
              costingMethod: "Standard",
              standardCost: 0,
              unitCost: 0,
              costIsAdjusted: false,
              companyId,
              createdBy: userId,
              updatedBy: userId,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
          }
        })
      );

      // Check for any errors
      const errors = itemCostUpdates.filter((result) => result.error);
      if (errors.length > 0) {
        return {
          error: {
            message: errors[0].error?.message || "Failed to update item costs"
          },
          data: null
        };
      }

      return {
        data: null,
        error: null
      };
    case "partId":
      if (items.length > 1) {
        return {
          error: { message: "Cannot update multiple items" },
          data: null
        };
      }
      const [item] = items as string[];
      const itemData = await client
        .from("item")
        .select("readableId, type")
        .eq("id", item)
        .eq("type", "Part")
        .eq("companyId", companyId)
        .single();

      if (itemData.error) {
        return itemData;
      }
      if (itemData.data?.type !== "Part") {
        return { error: { message: "Item is not a part" }, data: null };
      }

      const currentReadableId = itemData.data?.readableId;

      const relatedItems = await client
        .from("item")
        .select("id")
        .eq("readableId", currentReadableId)
        .eq("companyId", companyId);
      if (relatedItems.error) {
        return relatedItems;
      }
      const relatedItemIds = relatedItems.data?.map((item) => item.id);
      if (relatedItemIds) {
        const [itemUpdates, partUpdate] = await Promise.all([
          client
            .from("item")
            .update({
              readableId: value as string,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .in("id", relatedItemIds as string[])
            .eq("companyId", companyId),
          client
            .from("part")
            .update({
              id: value,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .eq("id", currentReadableId)
            .eq("companyId", companyId)
        ]);
        if (partUpdate.error) {
          return partUpdate;
        }

        return itemUpdates;
      }
    case "consumableId":
      if (items.length > 1) {
        return {
          error: { message: "Cannot update multiple items" },
          data: null
        };
      }
      const [consumableItem] = items as string[];
      const consumableData = await client
        .from("item")
        .select("readableId, type")
        .eq("id", consumableItem)
        .eq("type", "Consumable")
        .eq("companyId", companyId)
        .single();

      if (consumableData.error) {
        return consumableData;
      }
      if (consumableData.data?.type !== "Consumable") {
        return {
          error: { message: "Item is not a consumable" },
          data: null
        };
      }

      const currentConsumableId = consumableData.data?.readableId;

      const relatedConsumables = await client
        .from("item")
        .select("id")
        .eq("readableId", currentConsumableId)
        .eq("companyId", companyId);
      if (relatedConsumables.error) {
        return relatedConsumables;
      }
      const relatedConsumableIds = relatedConsumables.data?.map(
        (item) => item.id
      );
      if (relatedConsumableIds) {
        const [consumableItemUpdates, consumableUpdate] = await Promise.all([
          client
            .from("item")
            .update({
              readableId: value as string,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .in("id", relatedConsumableIds as string[])
            .eq("companyId", companyId),
          client
            .from("consumable")
            .update({
              id: value,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .eq("id", currentConsumableId)
            .eq("companyId", companyId)
        ]);
        if (consumableUpdate.error) {
          return consumableUpdate;
        }

        return consumableItemUpdates;
      }
    case "materialId":
      if (items.length > 1) {
        return {
          error: { message: "Cannot update multiple items" },
          data: null
        };
      }
      const [materialItem] = items as string[];
      const materialData = await client
        .from("item")
        .select("readableId, type")
        .eq("id", materialItem)
        .eq("type", "Material")
        .eq("companyId", companyId)
        .single();

      if (materialData.error) {
        return materialData;
      }
      if (materialData.data?.type !== "Material") {
        return {
          error: { message: "Item is not a material" },
          data: null
        };
      }

      const currentMaterialId = materialData.data?.readableId;

      const relatedMaterials = await client
        .from("item")
        .select("id")
        .eq("readableId", currentMaterialId)
        .eq("companyId", companyId);
      if (relatedMaterials.error) {
        return relatedMaterials;
      }
      const relatedMaterialIds = relatedMaterials.data?.map((item) => item.id);
      if (relatedMaterialIds) {
        const [materialItemUpdates, materialUpdate] = await Promise.all([
          client
            .from("item")
            .update({
              readableId: value as string,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .in("id", relatedMaterialIds as string[])
            .eq("companyId", companyId),
          client
            .from("material")
            .update({
              id: value,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .eq("id", currentMaterialId)
            .eq("companyId", companyId)
        ]);
        if (materialUpdate.error) {
          return materialUpdate;
        }

        return materialItemUpdates;
      }
    case "toolId":
      if (items.length > 1) {
        return {
          error: { message: "Cannot update multiple items" },
          data: null
        };
      }
      const [toolItem] = items as string[];
      const toolData = await client
        .from("item")
        .select("readableId, type")
        .eq("id", toolItem)
        .eq("type", "Tool")
        .eq("companyId", companyId)
        .single();

      if (toolData.error) {
        return toolData;
      }
      if (toolData.data?.type !== "Tool") {
        return { error: { message: "Item is not a tool" }, data: null };
      }

      const currentToolId = toolData.data?.readableId;

      const relatedTools = await client
        .from("item")
        .select("id")
        .eq("readableId", currentToolId)
        .eq("companyId", companyId);
      if (relatedTools.error) {
        return relatedTools;
      }
      const relatedToolIds = relatedTools.data?.map((item) => item.id);
      if (relatedToolIds) {
        const [toolItemUpdates, toolUpdate] = await Promise.all([
          client
            .from("item")
            .update({
              readableId: value as string,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .in("id", relatedToolIds as string[])
            .eq("companyId", companyId),
          client
            .from("tool")
            .update({
              id: value,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .eq("id", currentToolId)
            .eq("companyId", companyId)
        ]);
        if (toolUpdate.error) {
          return toolUpdate;
        }

        return toolItemUpdates;
      }
    default:
      return { error: { message: "Invalid field" }, data: null };
  }
}
