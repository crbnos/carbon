// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { workflowValidator } from "~/modules/workflows/workflows.models";

// The New Workflow modal opens the builder on success.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(workflowValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const { name, description } = input.data;
  return api.workflows.createWorkflow({ name, description });
}
