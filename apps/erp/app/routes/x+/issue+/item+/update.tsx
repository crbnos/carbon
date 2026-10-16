// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { carbon } from "~/modules/carbon.server";
import { disposition } from "~/modules/quality/quality.models";

// The disposition rows post one field at a time, as form strings.
const field = z.discriminatedUnion("field", [
  z.object({
    id: z.string(),
    field: z.literal("disposition"),
    value: z.enum(disposition)
  }),
  z.object({
    id: z.string(),
    field: z.literal("quantity"),
    value: zfd.numeric(z.number()),
    expectedQuantity: zfd.numeric(z.number())
  })
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(field).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.quality.issue.item.updateField(input.data);
}
