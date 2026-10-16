// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon } from "~/modules/carbon.server";
import { issueAssociationValidator } from "~/modules/quality/quality.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(issueAssociationValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.quality.issue.association.create({
    ...input.data,
    nonConformanceId: input.params.id
  });
}
