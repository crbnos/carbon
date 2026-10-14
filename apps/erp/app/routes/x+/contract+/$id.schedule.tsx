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
import { customerContractScheduleEditValidator } from "~/modules/sales";
import { runContractAction } from "~/modules/sales/sales.server";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

/** Edits a Draft contract's invoice schedule — move, split, merge, move a row,
 *  and the invoice grid's cell / add / delete — or resets it to the live plan.
 *  The server function owns every guard (Draft only, Planned invoices only, a
 *  split must still total its row) and its refusal is the reason shown.
 *
 *  A grid cell posts `quiet`: it gets `{ error }` back instead of a redirect
 *  and a flash, so typing across a row does not toast per cell. */
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
    customerContractScheduleEditValidator
  ).validate(formData);
  if (validation.error) {
    return quiet
      ? data({ error: "Invalid schedule edit" }, { status: 400 })
      : validationError(validation.error);
  }

  const asOf = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();
  const caller = { client, db: getDatabaseClient(), companyId, userId };

  const edit = validation.data;
  const result =
    edit.intent === "reset"
      ? await runContractAction(caller, {
          type: "reset-schedule",
          customerContractId: id,
          asOf
        })
      : await runContractAction(caller, {
          type: "edit-schedule",
          customerContractId: id,
          asOf,
          edit
        });

  const failure =
    edit.intent === "reset"
      ? "Failed to reset the invoice schedule"
      : "Failed to edit the invoice schedule";

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
        edit.intent === "reset"
          ? "Invoice schedule reset"
          : "Invoice schedule updated"
      )
    )
  );
}
