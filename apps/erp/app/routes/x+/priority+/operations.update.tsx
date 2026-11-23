// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { scheduleOperationUpdateValidator } from "~/modules/production/production.models";

// One card (`id`, `priority`), or a drop that renumbers several cards of a
// column (`updates`, JSON) in one request.
const moveForm = z.union([
  z.object({
    columnId: z.string().min(1),
    updates: z.string().transform((updates, issue) => {
      try {
        return JSON.parse(updates) as { id: string; priority: number }[];
      } catch {
        issue.addIssue({ code: "custom", message: "Invalid form data" });
        return z.NEVER;
      }
    })
  }),
  scheduleOperationUpdateValidator
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(moveForm).request(args);
  if ("invalid" in input) return input.invalid;
  const move = input.data;
  const api = await carbon(args.request);
  return api.production.reorderScheduleOperations({
    columnId: move.columnId,
    updates:
      "updates" in move
        ? move.updates
        : [{ id: move.id, priority: move.priority }]
  });
}
