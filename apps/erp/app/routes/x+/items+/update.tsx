import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import type { InventoryItemType } from "~/modules/items";
import { deriveItemMethodUpdate } from "~/modules/items";
import {
  getUnreleasedChangeOrderItems,
  unreleasedChangeOrderItemsMessage
} from "~/modules/items/items.server";
import {
  cascadeItemTrackingType,
  updateItemMethodAndSourcing,
  updateMaterialProperties
} from "~/modules/items/items.service";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "update");

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
        logger.error("Failed to cascade item tracking type", {
          field,
          itemIds: items,
          error: err
        });
        return {
          error: { message: "Failed to cascade tracking flags" },
          data: null
        };
      }

      return result;
    }
    case "name":
    case "description":
    case "mpn":
    case "unitOfMeasureCode":
      return await client
        .from("item")
        .update({
          [field]: value,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", items as string[])
        .eq("companyId", companyId);
    case "replenishmentSystem":
    case "defaultMethodType":
    case "sourcingType": {
      // These three fields are interlocked and each mirror down to the item's
      // method materials. updateItemMethodAndSourcing applies the item write
      // and the cascade in one transaction, so they can't be left half-applied.
      const { itemUpdate, cascade } = deriveItemMethodUpdate(field, value);
      try {
        await updateItemMethodAndSourcing(getDatabaseClient(), {
          itemIds: items as string[],
          companyId,
          userId,
          itemUpdate,
          cascade
        });
      } catch (err) {
        logger.error("Failed to update item method/sourcing", {
          field,
          value,
          itemIds: items,
          error: err
        });
        return { error: { message: "Failed to update item" }, data: null };
      }
      return { data: null, error: null };
    }
    case "gradeId":
    case "dimensionId":
    case "finishId":
    case "materialFormId":
    case "materialSubstanceId":
    case "materialTypeId": {
      const materialItems = await client
        .from("item")
        .select("readableId")
        .in("id", items as string[])
        .eq("companyId", companyId);
      if (materialItems.error) return materialItems;
      const materialIds = [
        ...new Set(materialItems.data.map((item) => item.readableId))
      ];
      if (materialIds.length === 0) {
        return { error: { message: "No materials found" }, data: null };
      }

      // One material row per readable id, shared by its revisions. The
      // service applies the dependent resets and, with generated material
      // IDs on, regenerates each material's readable id and name.
      for (const materialId of materialIds) {
        const update = await updateMaterialProperties(
          client,
          getDatabaseClient(),
          {
            id: materialId,
            companyId,
            updatedBy: userId,
            [field]: value || null
          }
        );
        if (update.error) {
          return { error: { message: update.error.message }, data: null };
        }
      }

      return { data: null, error: null };
    }
    case "active": {
      // Activating is the change notice's job: applyChangeNotice flips the
      // revisions and parts it minted when it reaches Done. Switching one on by
      // hand beforehand puts an unreleased item into the pickers, MRP and job
      // creation carrying the notice's un-approved draft BOM. Deactivating is
      // always allowed — that takes an item out of circulation, never into it.
      if (value === "on") {
        const unreleased = await getUnreleasedChangeOrderItems(
          getCarbonServiceRole(),
          { itemIds: items as string[], companyId }
        );
        if (unreleased.error) {
          return { error: { message: unreleased.error }, data: null };
        }
        if (unreleased.data.length > 0) {
          return {
            error: {
              message: `${unreleasedChangeOrderItemsMessage(
                unreleased.data
              )} Release the change notice to activate it.`
            },
            data: null
          };
        }
      }

      return await client
        .from("item")
        .update({
          active: value === "on",
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", items as string[])
        .eq("companyId", companyId);
    }

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
        .eq("type", "Part")
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
        .eq("type", "Consumable")
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
        .eq("type", "Material")
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
        .eq("type", "Tool")
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
    case "serviceId":
      if (items.length > 1) {
        return {
          error: { message: "Cannot update multiple items" },
          data: null
        };
      }
      const [serviceItem] = items as string[];
      const serviceData = await client
        .from("item")
        .select("readableId, type")
        .eq("id", serviceItem)
        .eq("type", "Service")
        .eq("companyId", companyId)
        .single();

      if (serviceData.error) {
        return serviceData;
      }
      if (serviceData.data?.type !== "Service") {
        return { error: { message: "Item is not a service" }, data: null };
      }

      const currentServiceId = serviceData.data?.readableId;

      const relatedServices = await client
        .from("item")
        .select("id")
        .eq("readableId", currentServiceId)
        .eq("type", "Service")
        .eq("companyId", companyId);
      if (relatedServices.error) {
        return relatedServices;
      }
      const relatedServiceIds = relatedServices.data?.map((item) => item.id);
      if (relatedServiceIds) {
        const [serviceItemUpdates, serviceUpdate] = await Promise.all([
          client
            .from("item")
            .update({
              readableId: value as string,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .in("id", relatedServiceIds as string[])
            .eq("companyId", companyId),
          client
            .from("service")
            .update({
              id: value,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .eq("id", currentServiceId)
            .eq("companyId", companyId)
        ]);
        if (serviceUpdate.error) {
          return serviceUpdate;
        }

        return serviceItemUpdates;
      }
    default:
      return { error: { message: "Invalid field" }, data: null };
  }
}
