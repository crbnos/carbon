// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { implementationHubVersionValidator } from "~/modules/shared/shared.models";

// The Implementation Hub Settings page's version switch: Carbon staff who can
// update settings choose whether the company uses Implementation Hub 1.0 or 2.0.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(implementationHubVersionValidator).request(
    args
  );
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.shared.setImplementationHubVersion(input.data);
}
