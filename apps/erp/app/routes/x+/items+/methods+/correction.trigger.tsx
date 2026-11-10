// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { methodCorrectionTriggerValidator } from "~/modules/items/items.models";
import {
  methodCorrectionEditRefusal,
  setMethodCorrectionTrigger
} from "~/modules/items/items.service";

/** Maps one step result to a correction, or clears the mapping. */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const validation = await validator(methodCorrectionTriggerValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const step = await client
    .from("methodOperationStep")
    .select("methodOperation!inner(makeMethodId)")
    .eq("id", validation.data.methodOperationStepId)
    .eq("companyId", companyId)
    .maybeSingle();
  const makeMethodId = step.data?.methodOperation?.makeMethodId;
  if (step.error || !makeMethodId) {
    return data(
      { success: false },
      await flash(request, error(step.error, "Step not found"))
    );
  }

  const refusal = await methodCorrectionEditRefusal(
    client,
    makeMethodId,
    companyId
  );
  if (refusal) {
    return data({ success: false }, await flash(request, error(null, refusal)));
  }

  const result = await setMethodCorrectionTrigger(client, {
    ...validation.data,
    companyId,
    userId
  });
  if (result.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(result.error, result.error.message ?? "Failed to map result")
      )
    );
  }

  return data(
    { success: true },
    await flash(
      request,
      success(
        validation.data.methodCorrectionId
          ? "Result mapped to the correction"
          : "Result mapping removed"
      )
    )
  );
}
