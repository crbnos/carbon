// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { optionalTiptapDoc } from "~/modules/shared/shared.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(
    z.object({ workInstruction: optionalTiptapDoc })
  ).request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.quality.setInspectionDocumentWorkInstruction({
    id: input.params.id,
    workInstruction: input.data.workInstruction
  });
}
