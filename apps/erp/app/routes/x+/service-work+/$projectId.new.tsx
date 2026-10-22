// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";
import { projectElementValidator } from "~/modules/projects/projects.models";

/**
 * Adds an element to a service order's or a service template's work
 * (`addServiceWorkElement`): the service twin of the project's
 * `elements.new`, under the service permission.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(projectElementValidator).request(args, {
    params: ["projectId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.service.addServiceWorkElement({
    ...input.data,
    projectId: input.params.projectId
  });
  if (result.error) {
    return data({ error: { message: result.error.message } }, { status: 400 });
  }
  return data(result.data, { status: 201 });
}
