// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

const mappingForm = z.object({
  modelUploadId: z.string().min(1),
  geometryHash: z.string().min(1),
  itemId: z.string().min(1)
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(mappingForm).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.production.mapAssemblyComponent({
    ...input.data,
    id: input.params.id
  });
}
