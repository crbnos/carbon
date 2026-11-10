// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { updateTrainingField } from "~/modules/resources/resources.server";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(updateTrainingField.input).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.updateTrainingField(input.data);
  // `Confirm` (the header's status changes, removing the guide) toasts only
  // `{ success: false, message }`.
  return result.error
    ? { ...result, success: false as const, message: result.error.message }
    : result;
}
