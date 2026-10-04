// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime, getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { customerContractRevenueEditValidator } from "~/modules/sales";
import { runContractAction } from "~/modules/sales/sales.server";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

/** Edits a Draft contract's revenue plan (plan D11) — one cell, a month added
 *  or deleted — or resets it to the live plan. The first edit stores the
 *  plan; the server function owns every guard (Draft only) and Confirm
 *  refuses a line whose revenue no longer totals what it bills.
 *
 *  A grid cell posts `quiet` and gets `{ error }` back instead of a redirect
 *  and a flash. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const quiet = formData.get("quiet") === "true";
  const validation = await validator(
    customerContractRevenueEditValidator
  ).validate(formData);
  if (validation.error) {
    return quiet
      ? data({ error: "Invalid revenue edit" }, { status: 400 })
      : validationError(validation.error);
  }

  const asOf = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();

  const edit = validation.data;
  const result = await runContractAction(
    { client, db: getDatabaseClient(), companyId, userId },
    {
      type: "edit-revenue",
      customerContractId: id,
      asOf,
      edit
    }
  );

  const failure =
    edit.intent === "reset"
      ? "Failed to reset the revenue plan"
      : "Failed to edit the revenue plan";

  if (quiet) {
    return result.error
      ? data({ error: getErrorMessage(result.error, failure) }, { status: 400 })
      : data({ error: null });
  }

  const back = requestReferrer(request) ?? path.to.contractDetails(id);
  if (result.error) {
    throw redirect(
      back,
      await flash(
        request,
        error(result.error, getErrorMessage(result.error, failure))
      )
    );
  }

  throw redirect(
    back,
    await flash(
      request,
      success(
        edit.intent === "reset" ? "Revenue plan reset" : "Revenue plan updated"
      )
    )
  );
}
