// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import {
  customerContractLineValidator,
  getContract,
  upsertContractLine
} from "~/modules/sales";
import type { ContractRouteData } from "~/modules/sales/ui/Contracts";
import { ContractLineForm } from "~/modules/sales/ui/Contracts";
import { path } from "~/utils/path";

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

  const formData = await request.formData();
  const validation = await validator(customerContractLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...line } = validation.data;

  // `upsertContractLine` refuses a contract that is not a Draft and an item
  // that is not a Service; its refusal message is what the user reads.
  const insert = await upsertContractLine(client, {
    ...line,
    // The contract checked above is the URL's — never the form's copy.
    customerContractId: id,
    companyId,
    createdBy: userId
  });

  if (insert.error) {
    throw redirect(
      path.to.contractDetails(id),
      await flash(
        request,
        error(insert.error, insert.error.message || "Failed to add line")
      )
    );
  }

  throw redirect(
    path.to.contractDetails(id),
    await flash(request, success("Added line to the contract"))
  );
}

export default function NewContractLineRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<ContractRouteData>(path.to.contract(id));
  if (!routeData) return null;

  const { contract } = routeData;

  return (
    <ContractLineForm
      key={id}
      initialValues={{
        customerContractId: id,
        revenueType: "Recurring",
        itemId: "",
        description: "",
        quantity: 1,
        rate: 0,
        // Every billing frequency is also a rate unit.
        rateUnit: contract.billingFrequency ?? "Month",
        discountPercent: 0,
        taxPercent: 0,
        startDate: contract.startDate ?? "",
        revenueMethod: "Daily",
        projectId: contract.projectId ?? undefined
      }}
      currencyCode={contract.currencyCode}
      isLocked={contract.status !== "Draft"}
    />
  );
}
