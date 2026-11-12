// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

// The editor's second step after it has staged a dropped STEP file.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(
    z.object({
      modelId: z.string().min(1),
      modelPath: z.string().min(1),
      name: z.string().min(1),
      size: zfd.numeric(z.number().nonnegative())
    })
  ).request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.quality.attachInspectionDocumentModel({
    id: input.params.id,
    modelId: input.data.modelId,
    path: input.data.modelPath,
    name: input.data.name,
    size: input.data.size
  });
}
