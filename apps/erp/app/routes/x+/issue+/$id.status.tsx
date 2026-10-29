// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { nonConformanceStatus } from "~/modules/quality/quality.models";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(
    z.object({ status: z.enum(nonConformanceStatus).exclude(["Closed"]) })
  ).request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.quality.setIssueStatus({
    id,
    status: input.data.status
  });
  return respond(args.request, result).redirect(
    requestReferrer(args.request) ?? path.to.issueDetails(id),
    { message: "Updated issue status" }
  );
}
