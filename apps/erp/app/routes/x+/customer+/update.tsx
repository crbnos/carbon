// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

const updateForm = z.object({
  ids: zfd.repeatableOfType(z.string()),
  field: z.enum(["taxCodeId"]),
  value: z.string().min(1, { message: "Select a tax code" })
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(updateForm).request(args);
  if ("invalid" in input) return input.invalid;
  const { ids, value } = input.data;
  const { api } = await authorize(args.request);

  return api.sales.assignCustomerTaxCode({ ids, taxCodeId: value });
}
