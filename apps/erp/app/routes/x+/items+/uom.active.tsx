// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { unitsOfMeasureActiveValidator } from "~/modules/items/items.models";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(unitsOfMeasureActiveValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.items.updateUnitsOfMeasureActive(input.data);
  return respond(args.request, result).redirect(
    requestReferrer(args.request) ?? path.to.uoms,
    {
      message: input.data.active
        ? "Turned on units of measure"
        : "Turned off units of measure"
    }
  );
}
