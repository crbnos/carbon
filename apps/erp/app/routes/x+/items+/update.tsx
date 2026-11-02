// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  isItemBulkUpdateField,
  itemBulkUpdateValidator
} from "~/modules/items/items.models";
import { startBackgroundBulkAction } from "~/utils/table-jobs.server";

// The items tables' bulk actions and the item properties panels: one field of
// one or more items per post. The tables' Update posts `allMatching` in
// place of the ids for every matching item.
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
  value: z.string(),
  allMatching: zfd.text(z.string().optional())
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
  const { items: ids, field, value, allMatching } = input.data;

  // The fields the tables' Update sets on many items: one operation for
  // both paths (`updateItems`). Every matching row goes to the background
  // job, which runs the same operation 100 items at a time.
  if (isItemBulkUpdateField(field)) {
    const change = itemBulkUpdateValidator.safeParse({ field, value });
    if (!change.success) return invalid(`${value} is not a valid ${field}`);
    const started = await startBackgroundBulkAction(
      args.request,
      "items.update",
      { allMatching },
      change.data
    );
    if (started) return started;
    const api = await carbon(args.request);
    return api.items.updateItems({ ids, change: change.data });
  }

  const api = (await carbon(args.request)).items;

  switch (field) {
    case "name":
    case "description":
    case "mpn":
    case "unitOfMeasureCode":
      return api.setItemFields({ ids, [field]: value });
    case "gradeId":
    case "dimensionId":
    case "finishId":
    case "materialFormId":
    case "materialSubstanceId":
    case "materialTypeId":
      return api.setMaterialProperties({ ids, [field]: value || null });
    case "active":
      return api.setItemActive({ ids, active: value === "on" });
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
