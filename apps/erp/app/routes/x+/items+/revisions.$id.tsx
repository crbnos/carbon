// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { revisionValidator } from "~/modules/items/items.models";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(revisionValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;

  const api = await carbon(args.request);
  const result = await api.items.updateRevision({
    id: input.params.id,
    revision: input.data.revision
  });

  if (result.error) {
    return { success: false, message: result.error.message };
  }

  // A revision is its own item row, so the edited revision keeps its id.
  return {
    success: true,
    link: getLinkToItemDetails(input.data.type, input.params.id)
  };
}
