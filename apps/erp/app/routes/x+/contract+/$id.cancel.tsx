// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { serverFns } from "@carbon/server-functions";
import type {
  ContractCancellationPreview,
  ContractCancellationResult
} from "@carbon/server-functions/post-customer-contract";
import { datetime, getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { customerContractCancelValidator } from "~/modules/sales";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

/** The preview answers before the reason is filled in. */
const cancelPreviewValidator = customerContractCancelValidator.omit({
  reason: true
});

type ContractCancelPreviewResponse = {
  preview: ContractCancellationPreview | null;
  error: string | null;
};

/** Cancels an Active contract from an end date, optionally crediting the
 *  unused billed time on a Draft credit memo. `intent=preview` runs the same
 *  cancellation in a transaction the server function rolls back and returns
 *  the credit available; anything else saves it. */
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
    const validation = await validator(cancelPreviewValidator).validate(
      formData
    );
    if (validation.error) {
      return data<ContractCancelPreviewResponse>({
        preview: null,
        error:
          Object.values(validation.error.fieldErrors)[0] ??
          "The cancellation is incomplete"
      });
    }
    const result = await contracts.invoke("post-customer-contract", {
      type: "cancel",
      customerContractId: id,
      asOf,
      endDate: validation.data.endDate,
      // Recorded only; the preview's credit does not depend on either.
      reason: "Preview",
      creditUnusedTime: false,
      preview: true
    });
    if (result.error) {
      return data<ContractCancelPreviewResponse>({
        preview: null,
        error: getErrorMessage(
          result.error,
          "Failed to preview the cancellation"
        )
      });
    }
    return data<ContractCancelPreviewResponse>({
      preview: isCancellationPreview(result.data) ? result.data : null,
      error: null
    });
  }

  const validation = await validator(customerContractCancelValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { endDate, reason, creditUnusedTime } = validation.data;
  const result = await contracts.invoke("post-customer-contract", {
    type: "cancel",
    customerContractId: id,
    asOf,
    endDate,
    reason,
    creditUnusedTime
  });

  if (result.error) {
    throw redirect(
      path.to.contractDetails(id),
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(result.error, "Failed to cancel the contract")
        )
      )
    );
  }

  // The memo is linked from the credit rows of the Invoices section.
  const memoReadableId = isCancellationResult(result.data)
    ? result.data.memoReadableId
    : null;
  throw redirect(
    path.to.contractDetails(id),
    await flash(
      request,
      success(
        memoReadableId
          ? `Cancelled. Credit memo ${memoReadableId} drafted`
          : "Contract cancelled"
      )
    )
  );
}

function isCancellationPreview(
  value: unknown
): value is ContractCancellationPreview {
  return (
    typeof value === "object" &&
    value !== null &&
    "creditAvailable" in value &&
    "credit" in value
  );
}

function isCancellationResult(
  value: unknown
): value is ContractCancellationResult {
  return typeof value === "object" && value !== null && "memoId" in value;
}
