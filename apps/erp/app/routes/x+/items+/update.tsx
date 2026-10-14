// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { unchecked } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { isItemBulkUpdateField } from "~/modules/items";
import { bulkUpdateItems } from "~/modules/items/bulk-actions.server";
import {
  getUnreleasedChangeOrderItems,
  unreleasedChangeOrderItemsMessage
} from "~/modules/items/items.server";
import {
  updateMaterialProperties,
  updateServiceName
} from "~/modules/items/items.service";
import { getDatabaseClient } from "~/services/database.server";
import { bulkStartFormResponse } from "~/utils/table-jobs";
import { startAllMatchingBulkAction } from "~/utils/table-jobs.server";

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

  // The item tables' bulk Update: every matching row runs in the background,
  // a selection runs here. Both go through bulkUpdateItems.
  if (isItemBulkUpdateField(field)) {
    const started = await startAllMatchingBulkAction(
      formData.get("allMatching"),
      { companyId, userId, actionKey: "items.update", params: { field, value } }
    );
    if (started) return bulkStartFormResponse(started);

    // Each chunk of 100 commits on its own, so a failure can follow applied
    // chunks: the counts let the table say what was done.
    const result = await bulkUpdateItems(client, getDatabaseClient(), {
      itemIds: items as string[],
      field,
      value,
      companyId,
      userId
    });
    return result.error
      ? {
          error: { message: result.error },
          data: null,
          done: result.done,
          failed: result.failed
        }
      : { data: null, error: null };
  }

  switch (field) {
    case "name":
    case "description":
    case "mpn":
    case "unitOfMeasureCode":
      return await client
        .from("item")
        .update(
          unchecked({
            [field]: value,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
        )
        .in("id", items as string[])
        .eq("companyId", companyId);
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

      // Each material commits on its own, so try them all and name every
      // refusal rather than stopping partway through the selection.
      const failures: string[] = [];
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
          failures.push(`${materialId}: ${update.error.message}`);
        }
      }
      if (failures.length > 0) {
        return { error: { message: failures.join("; ") }, data: null };
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
    case "serviceName": {
      if (items.length > 1) {
        return {
          error: { message: "Cannot update multiple items" },
          data: null
        };
      }
      try {
        return await updateServiceName(getDatabaseClient(), {
          itemId: items[0] as string,
          name: value,
          companyId,
          userId
        });
      } catch (err) {
        logger.error("Failed to update service name", {
          itemIds: items,
          error: err
        });
        return {
          error: { message: "Failed to update service name" },
          data: null
        };
      }
    }
    default:
      return { error: { message: "Invalid field" }, data: null };
  }
}
