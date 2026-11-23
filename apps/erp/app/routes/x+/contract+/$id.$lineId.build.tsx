// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { contractLineBuildValidator } from "~/modules/sales/sales.models";
import { path } from "~/utils/path";

export type ContractLineBuildResult = { error: { message: string } };

/**
 * Build: a job for a part CLIN (spec section 10.2), charged to the task the
 * user picks under the line's project and linked to the CLIN
 * (`sales.buildContractLineJob`). The action redirects to the job.
 */
export async function action({
  request,
  params
}: ActionFunctionArgs): Promise<ContractLineBuildResult> {
  assertIsPost(request);
  const { id, lineId } = params;
  if (!id) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");

  const validation = await validator(contractLineBuildValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return { error: { message: "Enter a task, a quantity and a location" } };
  }

  const api = await carbon(request);
  const result = await api.sales.buildContractLineJob({
    ...validation.data,
    customerContractId: id,
    customerContractLineId: lineId
  });
  if (result.error) return { error: { message: result.error.message } };

  throw redirect(path.to.job(result.data.jobId));
}
