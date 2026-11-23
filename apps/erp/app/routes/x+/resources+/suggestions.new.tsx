// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { suggestionValidator } from "~/modules/shared/shared.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(suggestionValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { userId, ...suggestion } = input.data;
  const api = await carbon(args.request);
  // The form's `userId` is only an on/off signal: the suggestion is
  // attributed to the session's user, or to nobody.
  return api.resources.createSuggestion({
    ...suggestion,
    attributed: !!userId
  });
}
