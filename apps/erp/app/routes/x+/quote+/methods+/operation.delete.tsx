// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

// One `id` per operation, so the bill of process's Delete Selected is one
// request and the line is repriced once.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(
    z.object({ id: zfd.repeatable(z.array(z.string().min(1)).min(1)) })
  ).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.sales.deleteQuoteOperationsAndReprice({ ids: input.data.id });
}
