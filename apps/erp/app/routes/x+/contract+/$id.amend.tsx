// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { serverFns } from "@carbon/server-functions";
import type { ContractAmendmentPreview } from "@carbon/server-functions/post-customer-contract";
import { datetime, getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { customerContractAmendmentValidator } from "~/modules/sales";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

/** The preview answers before the reason and type are filled in — the type
 *  is pre-filled FROM the preview — so it validates without them. */
const amendmentPreviewValidator = customerContractAmendmentValidator.omit({
  reason: true,
  contractType: true
});

type ContractAmendPreviewResponse = {
  preview: ContractAmendmentPreview | null;
  error: string | null;
};

/** Amends an Active contract: change, add or end lines from an effective
 *  date. `intent=preview` runs the same amendment in a transaction the server
 *  function rolls back, and returns the adjustments, the next two invoices
 *  and the suggested type; anything else saves it. The server function owns
 *  every guard and its refusal is the reason shown. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const isPreview = formData.get("intent") === "preview";

  const asOf = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();
  const contracts = serverFns.as({
    client,
    db: getDatabaseClient(),
    companyId,
    userId
  });

  if (isPreview) {
    const validation = await validator(amendmentPreviewValidator).validate(
      formData
    );
    if (validation.error) {
      return data<ContractAmendPreviewResponse>({
        preview: null,
        error:
          Object.values(validation.error.fieldErrors)[0] ??
          "The amendment is incomplete"
      });
    }
    const { amendmentDate, effect, changes } = validation.data;
    const result = await contracts.invoke("post-customer-contract", {
      type: "amend",
      customerContractId: id,
      asOf,
      amendmentDate,
      effect,
      // Neither changes what the amendment does; both are recorded only.
      contractType: "Existing",
      reason: "Preview",
      changes,
      preview: true
    });
    if (result.error) {
      return data<ContractAmendPreviewResponse>({
        preview: null,
        error: getErrorMessage(result.error, "Failed to preview the amendment")
      });
    }
    return data<ContractAmendPreviewResponse>({
      preview: isAmendmentPreview(result.data) ? result.data : null,
      error: null
    });
  }

  const validation = await validator(
    customerContractAmendmentValidator
  ).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  const { amendmentDate, effect, contractType, reason, changes } =
    validation.data;
  const result = await contracts.invoke("post-customer-contract", {
    type: "amend",
    customerContractId: id,
    asOf,
    amendmentDate,
    effect,
    contractType,
    reason,
    changes
  });

  if (result.error) {
    throw redirect(
      path.to.contractDetails(id),
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(result.error, "Failed to amend the contract")
        )
      )
    );
  }

  throw redirect(
    path.to.contractDetails(id),
    await flash(request, success("Contract amended"))
  );
}

function isAmendmentPreview(value: unknown): value is ContractAmendmentPreview {
  return (
    typeof value === "object" &&
    value !== null &&
    "nextInvoices" in value &&
    "adjustments" in value
  );
}
