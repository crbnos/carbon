// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { customerContractScheduleEditValidator } from "~/modules/sales/sales.models";
import { path, requestReferrer } from "~/utils/path";

/** Edits a Draft contract's invoice schedule — move, split, merge, move a row,
 *  and the invoice grid's cell / add / delete — or resets it to the live plan.
 *  The server function owns every guard (Draft only, Planned invoices only, a
 *  split must still total its row) and its refusal is the reason shown.
 *
 *  A grid cell posts `quiet`: it gets `{ error }` back instead of a redirect
 *  and a flash, so typing across a row does not toast per cell. */
export async function action({ request, params }: ActionFunctionArgs) {
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

  const edit = validation.data;
  const api = await carbon(request);
  const result =
    edit.intent === "reset"
      ? await api.sales.resetContractSchedule({ customerContractId: id })
      : await api.sales.editContractSchedule({ customerContractId: id, edit });

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
    throw redirect(back, await flash(request, error(result.error, failure)));
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
