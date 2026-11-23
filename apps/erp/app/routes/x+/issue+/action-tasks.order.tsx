// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

// The task list posts its new order as one JSON field: task id → position.
const order = z.object({
  updates: zfd.json(z.record(z.string(), z.coerce.number()))
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(order).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.quality.reorderIssueActionTasks(input.data);
}
