// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { implementationLayoutValidator } from "~/modules/shared/shared.models";

// The hub Settings page's layout switch: Carbon staff who can update settings
// choose which Implementation Hub layout the company uses.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(implementationLayoutValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.shared.setImplementationLayout(input.data);
}
