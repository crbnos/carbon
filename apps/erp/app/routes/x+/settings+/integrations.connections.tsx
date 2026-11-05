// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { integrationConnectionActionValidator } from "~/modules/settings/settings.models";

export const config = {
  runtime: "nodejs"
};

export async function action(args: ActionFunctionArgs) {
  const input = await validator(integrationConnectionActionValidator).request(
    args
  );
  if ("invalid" in input) return input.invalid;

  const api = await carbon(args.request);
  if (input.data.intent === "rename") {
    return api.settings.renameIntegrationConnection({
      id: input.data.id,
      name: input.data.name
    });
  }
  return api.settings.disconnectIntegrationConnection({ id: input.data.id });
}
