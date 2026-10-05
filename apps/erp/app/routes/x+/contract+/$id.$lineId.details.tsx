// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect, round } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useRouteData } from "~/hooks";
import {
  customerContractLineValidator,
  getContract,
  getContractLine,
  upsertContractLine
} from "~/modules/sales";
import type { ContractRouteData } from "~/modules/sales/ui/Contracts";
import { ContractLineForm } from "~/modules/sales/ui/Contracts";
import { path, requestReferrer } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

  const line = await getContractLine(client, lineId);
  if (
    line.error ||
    line.data.companyId !== companyId ||
    line.data.customerContractId !== id
  ) {
    throw redirect(
      path.to.contractDetails(id),
      await flash(request, error(line.error, "Failed to load the line"))
    );
  }

  return { line: line.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

  const contract = await getContract(client, id);
  if (contract.error || contract.data?.companyId !== companyId) {
    throw redirect(
      path.to.contracts,
      await flash(request, error(contract.error, "Contract not found"))
    );
  }

  const formData = await request.formData();
  const validation = await validator(customerContractLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...line } = validation.data;

  // `upsertContractLine` refuses a line of another contract, a contract that
  // is not a Draft and an item that is not a Service.
  const update = await upsertContractLine(client, {
    ...line,
    customerContractId: id,
    id: lineId,
    updatedBy: userId
  });

  // Back to where the form was opened: the line's page, or the setup grid
  // that opened it as a modal.
  const back = requestReferrer(request) ?? path.to.contractLine(id, lineId);
  if (update.error) {
    throw redirect(
      back,
      await flash(
        request,
        error(update.error, update.error.message || "Failed to update line")
      )
    );
  }

  throw redirect(back, await flash(request, success("Updated line")));
}

/** One line of the contract. Editable while the contract is a Draft; an
 *  Active contract's lines change through Amend. */
export default function ContractLineRoute() {
  const { line } = useLoaderData<typeof loader>();

  const routeData = useRouteData<ContractRouteData>(
    path.to.contract(line.customerContractId)
  );
  if (!routeData) return null;

  const { contract } = routeData;

  return (
    <ContractLineForm
      key={`${line.id}-${line.updatedAt ?? ""}`}
      title={line.description || line.item?.name || line.itemId}
      initialValues={{
        id: line.id,
        customerContractId: line.customerContractId,
        revenueType: line.revenueType,
        itemId: line.itemId,
        description: line.description ?? undefined,
        quantity: Number(line.quantity),
        rate: Number(line.rate),
        rateUnit: line.rateUnit ?? undefined,
        // Stored as a 0–1 fraction; the form takes percent points.
        discountPercent: round(Number(line.discountPercent) * 100),
        discountEndsOn: line.discountEndsOn ?? undefined,
        taxPercent: round(Number(line.taxPercent) * 100),
        startDate: line.startDate,
        endDate: line.endDate ?? undefined,
        goLiveDate: line.goLiveDate ?? undefined,
        revenueMethod: line.revenueMethod,
        revenueStartDate: line.revenueStartDate ?? undefined,
        revenueEndDate: line.revenueEndDate ?? undefined,
        projectId: line.projectId ?? undefined
      }}
      currencyCode={contract.currencyCode}
      isLocked={contract.status !== "Draft"}
    />
  );
}
