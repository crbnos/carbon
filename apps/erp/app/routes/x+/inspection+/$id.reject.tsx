// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { carbon, redirectWithResult } from "~/modules/carbon.server";
import { path } from "~/utils/path";

// Opening an issue is optional: the inspector may reject without one.
const reject = z.object({
  nonConformanceTypeId: zfd.text(z.string().optional()),
  createNcr: zfd.text(z.string().optional())
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(reject).request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.quality.inspection.reject({
    id,
    nonConformanceTypeId: input.data.nonConformanceTypeId,
    createNcr: input.data.createNcr !== "false"
  });
  if (result.error || !result.data.issueId) {
    return redirectWithResult(args.request, result, {
      to: path.to.inspection(id),
      message: "Lot rejected"
    });
  }
  return redirectWithResult(args.request, result, {
    to: path.to.issue(result.data.issueId),
    message: "Lot rejected — NCR opened"
  });
}
