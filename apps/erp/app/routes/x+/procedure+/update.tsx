// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import type { procedureStatus } from "~/modules/production/production.models";

// The procedure properties panel: one field of one or more procedures.
const updateForm = z.object({
  ids: zfd.repeatableOfType(z.string()),
  field: z.enum(["content", "name", "status", "processId", "tags"]),
  value: zfd.repeatableOfType(z.string()).pipe(z.array(z.string()).min(1))
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(updateForm).request(args);
  if ("invalid" in input) return input.invalid;
  const { ids, field, value } = input.data;
  const api = await carbon(args.request);
  if (field === "tags") {
    return api.production.setProcedureFields({ ids, tags: value });
  }
  if (field === "status") {
    return api.production.setProcedureFields({
      ids,
      status: value[0] as (typeof procedureStatus)[number]
    });
  }
  return api.production.setProcedureFields({ ids, [field]: value[0] ?? "" });
}
