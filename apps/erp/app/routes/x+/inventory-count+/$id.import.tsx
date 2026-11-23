// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { inventoryCountImportValidator } from "~/modules/inventory/inventory.models";
import { parseInventoryCountCsv } from "~/modules/inventory/inventory.utils";

// A count results file. A file that does not parse returns its errors and
// writes nothing.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(inventoryCountImportValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const parsed = parseInventoryCountCsv(await input.data.file.text());
  if (parsed.errors.length > 0) {
    return { data: { errors: parsed.errors }, error: null };
  }
  const api = await carbon(args.request);
  return api.inventory.importInventoryCountResults({
    inventoryCountId: input.params.id,
    rows: parsed.rows
  });
}
