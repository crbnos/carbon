// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { serverFns } from "@carbon/server-functions";
import { datetime, getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { customerContractScheduleEditValidator } from "~/modules/sales";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

/** Edits a Draft contract's invoice schedule — move, split, merge, move a row
 *  — or resets it to the live plan. The server function owns every guard
 *  (Draft only, Planned invoices only, a split must still total its row) and
 *  its refusal is flashed as the reason. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const validation = await validator(
    customerContractScheduleEditValidator
  ).validate(await request.formData());
  if (validation.error) {
    return validationError(validation.error);
  }

  const asOf = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();
  const contracts = serverFns.as({
    client,
    db: getDatabaseClient(),
    companyId,
    userId
  });

  const edit = validation.data;
  const result =
    edit.intent === "reset"
      ? await contracts.invoke("post-customer-contract", {
          type: "reset-schedule",
          customerContractId: id,
          asOf
        })
      : await contracts.invoke("post-customer-contract", {
          type: "edit-schedule",
          customerContractId: id,
          asOf,
          edit
        });

  if (result.error) {
    throw redirect(
      path.to.contractDetails(id),
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(
            result.error,
            edit.intent === "reset"
              ? "Failed to reset the invoice schedule"
              : "Failed to edit the invoice schedule"
          )
        )
      )
    );
  }

  throw redirect(
    path.to.contractDetails(id),
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
