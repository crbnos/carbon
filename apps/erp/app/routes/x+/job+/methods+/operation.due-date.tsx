// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

const dueDateForm = z.object({
  id: z.string().min(1),
  dueDate: zfd.text(z.string().optional())
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(dueDateForm).request(args);
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  return api.production.setJobOperationDueDate({
    id: input.data.id,
    dueDate: input.data.dueDate ?? null
  });
}
