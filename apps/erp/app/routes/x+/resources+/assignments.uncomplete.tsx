// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { uncompleteTrainingAssignment } from "~/modules/resources/resources.server";
import { path, requestReferrer } from "~/utils/path";

// The Confirm dialog posts through a fetcher and toasts only a flash, so the
// result goes back to the page it came from as one.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(uncompleteTrainingAssignment.input).request(
    args
  );
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.uncompleteTrainingAssignment(input.data);
  return respond(args.request, result).redirect(
    requestReferrer(args.request) ?? path.to.trainingAssignments,
    { message: "Completion removed" }
  );
}

export async function loader() {
  return redirect(path.to.trainingAssignments);
}
