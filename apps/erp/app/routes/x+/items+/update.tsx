// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import type { itemTrackingTypes } from "~/modules/items/items.models";
import type { methodType, sourcingType } from "~/modules/shared/shared.models";

// The items tables' bulk actions and the item properties panels: one field of
// one or more items per post.
const updateForm = z.object({
  items: zfd.repeatableOfType(z.string()),
  field: z.enum([
    "itemTrackingType",
    "name",
    "description",
    "mpn",
    "unitOfMeasureCode",
    "replenishmentSystem",
    "defaultMethodType",
    "sourcingType",
    "gradeId",
    "dimensionId",
    "finishId",
    "materialFormId",
    "materialSubstanceId",
    "materialTypeId",
    "active",
    "itemPostingGroupId",
    "partId",
    "consumableId",
    "materialId",
    "toolId",
    "serviceName"
  ]),
  value: z.string()
});

const invalid = (message: string) => ({ data: null, error: { message } });

const renumberType = {
  partId: "Part",
  consumableId: "Consumable",
  materialId: "Material",
  toolId: "Tool"
} as const;

export async function action(args: ActionFunctionArgs) {
  const input = await validator(updateForm).request(args);
  if ("invalid" in input) return input.invalid;
  const { items: ids, field, value } = input.data;
  const api = (await carbon(args.request)).items;

  switch (field) {
    case "itemTrackingType":
      return api.setItemTrackingType({
        ids,
        itemTrackingType: value as (typeof itemTrackingTypes)[number]
      });
    case "name":
    case "description":
    case "mpn":
    case "unitOfMeasureCode":
      return api.setItemFields({ ids, [field]: value });
    case "replenishmentSystem":
      return api.setItemSourcing({
        ids,
        replenishmentSystem: value as "Buy" | "Make" | "Buy and Make"
      });
    case "defaultMethodType":
      return api.setItemSourcing({
        ids,
        defaultMethodType: value as (typeof methodType)[number]
      });
    case "sourcingType":
      return api.setItemSourcing({
        ids,
        sourcingType: value as (typeof sourcingType)[number]
      });
    case "gradeId":
    case "dimensionId":
    case "finishId":
    case "materialFormId":
    case "materialSubstanceId":
    case "materialTypeId":
      return api.setMaterialProperties({ ids, [field]: value || null });
    case "active":
      return api.setItemActive({ ids, active: value === "on" });
    case "itemPostingGroupId":
      return api.setItemPostingGroup({
        ids,
        itemPostingGroupId: value || null
      });
    case "partId":
    case "consumableId":
    case "materialId":
    case "toolId":
      if (ids.length > 1) return invalid("Cannot update multiple items");
      return api.setItemReadableId({
        id: ids[0],
        type: renumberType[field],
        readableId: value
      });
    case "serviceName":
      if (ids.length > 1) return invalid("Cannot update multiple items");
      return api.renameService({ itemId: ids[0], name: value });
  }
}
