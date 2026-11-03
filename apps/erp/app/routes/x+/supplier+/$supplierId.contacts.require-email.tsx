// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

const requireContactEmailValidator = z.object({
  requireContactEmail: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(requireContactEmailValidator).request(args, {
    params: ["supplierId"]
  });
  if ("invalid" in input) return input.invalid;

  const api = await carbon(args.request);
  return api.purchasing.setSupplierRequireContactEmail({
    supplierId: input.params.supplierId,
    requireContactEmail: input.data.requireContactEmail
  });
}
