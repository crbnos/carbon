// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { setIssueTaskStatus } from "~/modules/quality/quality.server";

// The body carries the task id too; the URL's is the one written.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(setIssueTaskStatus.input).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.quality.setIssueTaskStatus({
    ...input.data,
    id: input.params.id
  });
}
