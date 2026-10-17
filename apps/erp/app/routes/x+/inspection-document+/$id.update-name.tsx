// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(
    z.object({ drawingNumber: z.string().optional() })
  ).request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.quality.setInspectionDocumentDrawingNumber({
    id: input.params.id,
    drawingNumber: input.data.drawingNumber
  });
}
