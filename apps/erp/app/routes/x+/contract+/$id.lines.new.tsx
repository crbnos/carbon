// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime, redirect, round } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { applyLineTaxDecision } from "~/modules/accounting/accounting.utils";
import { customerContractLineValidator } from "~/modules/sales/sales.models";
import {
  getContract,
  projectRevenueRefusal
} from "~/modules/sales/sales.service";
import type { ContractRouteData } from "~/modules/sales/ui/Contracts";
import {
  ContractLineForm,
  newContractLineFormValues
} from "~/modules/sales/ui/Contracts";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
import { path } from "~/utils/path";

/** The tax a new line opens with: the contract's ship-to's or customer's
 *  code on the contract's start date, with no item. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api, client, companyId } = await authorize(request, {
    "sales.serviceContracts": "Create"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const contract = await api.sales.getContract({ customerContractId: id });
  if (contract.error || contract.data?.companyId !== companyId) {
    return { resolvedTax: null };
  }

  const date =
    contract.data.startDate ??
    datetime.today(await getCompanyTimeZone(client, companyId)).toString();
  const tax = await api.accounting.resolveLineTaxes({
    source: "sales",
    customerId: contract.data.customerId,
    customerLocationId: contract.data.shipToCustomerLocationId,
    date
  });
  // Only a code (or an exemption) changes the default: with no code a new
  // line opens at 0%, as before tax codes.
  return {
    resolvedTax: tax.data
      ? applyLineTaxDecision(tax.data, { taxCodeId: null, taxPercent: 0 })
      : null
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { api, client, companyId } = await authorize(request, {
    "sales.serviceContracts": "Create"
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

  const upgrade = await projectRevenueRefusal(client, companyId, [line]);
  if (upgrade) {
    throw redirect(
      path.to.contractDetails(id),
      await flash(request, error(null, upgrade))
    );
  }

  // `createContractLine` refuses a contract that is not a Draft and an item
  // its basis does not take; its refusal message is what the user reads. It
  // decides the tax: a caller that does not post the field (the form does;
  // an empty one is a cleared code) takes the ship-to's or customer's code.
  const insert = await api.sales.createContractLine({
    ...line,
    taxCodeId: formData.has("taxCodeId") ? (line.taxCodeId ?? null) : undefined,
    // The contract checked above is the URL's — never the form's copy.
    customerContractId: id
  });

  if (insert.error) {
    throw redirect(
      path.to.contractDetails(id),
      await flash(request, error(insert.error, "Failed to add line"))
    );
  }

  throw redirect(
    path.to.contractDetails(id),
    await flash(request, success("Added line to the contract"))
  );
}

export default function NewContractLineRoute() {
  const { resolvedTax } = useLoaderData<typeof loader>();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<ContractRouteData>(path.to.contract(id));
  if (!routeData) return null;

  const { contract } = routeData;

  return (
    <ContractLineForm
      key={id}
      initialValues={{
        ...newContractLineFormValues(contract),
        // The form types percent points.
        taxPercent: round((resolvedTax?.taxPercent ?? 0) * 100),
        taxCodeId: resolvedTax?.taxCodeId ?? undefined
      }}
      currencyCode={contract.currencyCode}
      billingBasis={contract.billingBasis}
      isLocked={contract.status !== "Draft"}
    />
  );
}
