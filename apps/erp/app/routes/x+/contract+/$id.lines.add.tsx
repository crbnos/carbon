// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  customerContractLinesAddValidator,
  getContract,
  insertContractLines
} from "~/modules/sales";
import { path, requestReferrer } from "~/utils/path";

/** Adds the chosen Service items to a Draft contract, each as a line with a
 *  new line's defaults (`$id.lines.new`): Recurring, quantity 1, billed per
 *  the contract's billing frequency from its start date. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const contract = await getContract(client, id, companyId);
  if (contract.error || contract.data?.companyId !== companyId) {
    throw redirect(
      path.to.contracts,
      await flash(request, error(contract.error, "Contract not found"))
    );
  }

  const validation = await validator(
    customerContractLinesAddValidator
  ).validate(await request.formData());
  if (validation.error) {
    return validationError(validation.error);
  }

  const back = requestReferrer(request) ?? path.to.contractDetails(id);
  if (!contract.data.startDate) {
    throw redirect(
      back,
      await flash(request, error(null, "Set the contract's start date first"))
    );
  }

  // Refuses a contract that is not a Draft and an item that is not a Service.
  const insert = await insertContractLines(client, {
    customerContractId: id,
    companyId,
    createdBy: userId,
    itemIds: validation.data.itemIds,
    revenueType: "Recurring",
    // Every billing frequency is also a rate unit.
    rateUnit: contract.data.billingFrequency ?? "Month",
    startDate: contract.data.startDate,
    projectId: contract.data.projectId
  });

  if (insert.error) {
    throw redirect(
      back,
      await flash(
        request,
        error(insert.error, insert.error.message || "Failed to add services")
      )
    );
  }

  throw redirect(
    back,
    await flash(
      request,
      success(
        insert.data.length === 1
          ? "Added 1 service to the contract"
          : `Added ${insert.data.length} services to the contract`
      )
    )
  );
}
