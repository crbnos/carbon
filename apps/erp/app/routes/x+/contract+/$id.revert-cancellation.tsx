// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { serverFns } from "@carbon/server-functions";
import { datetime, getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

/** Undoes a cancellation while its end date has not passed and its credit
 *  memo is still Draft: the end date, renewal and line end dates come back,
 *  the Draft memo is deleted and the schedule is planned again. The server
 *  function owns those guards and its refusal is flashed as the reason. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  // Reverting deletes the cancellation's Draft credit memo, so it needs the
  // invoicing permission too — but only when there is a memo: a cancellation
  // without credit touches sales data alone. The server function deletes
  // exactly the memos on the contract's invoice-line rows; a failed read
  // asks for the permission rather than skip the check.
  const memoRows = await client
    .from("customerContractInvoiceLine")
    .select("id")
    .eq("customerContractId", id)
    .eq("companyId", companyId)
    .not("memoId", "is", null)
    .limit(1);
  if (memoRows.error || (memoRows.data?.length ?? 0) > 0) {
    await requirePermissions(request, {
      update: "sales",
      delete: "invoicing"
    });
  }

  const asOf = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();
  const result = await serverFns
    .as({ client, db: getDatabaseClient(), companyId, userId })
    .invoke("post-customer-contract", {
      type: "revert-cancellation",
      customerContractId: id,
      asOf
    });

  if (result.error) {
    throw redirect(
      path.to.contractDetails(id),
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(result.error, "Failed to revert the cancellation")
        )
      )
    );
  }

  throw redirect(
    path.to.contractDetails(id),
    await flash(request, success("Cancellation reverted"))
  );
}
