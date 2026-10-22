// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";

/**
 * Deletes an element of a service order's or a service template's work and
 * everything below it (`deleteServiceWorkElement`), then goes back to the
 * work. An element with charges cannot be deleted; the refusal stays on the
 * page with its reason.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["projectId", "elementId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.service.deleteServiceWorkElement(input.params);
  if (result.error) {
    return data(
      { success: false },
      await flash(args.request, error(null, result.error.message))
    );
  }
  return respond(args.request, result).redirect(result.data.workPath, {
    message: "Element deleted"
  });
}
