// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime, redirect, round } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { resolveLineTaxes } from "~/modules/accounting";
import {
  customerContractLineValidator,
  getContract,
  upsertContractLine
} from "~/modules/sales";
import type { ContractRouteData } from "~/modules/sales/ui/Contracts";
import { ContractLineForm } from "~/modules/sales/ui/Contracts";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { path } from "~/utils/path";

/** The tax a new line opens with: the contract's ship-to's or customer's
 *  code on the contract's start date, with no item. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const contract = await getContract(client, id, companyId);
  if (contract.error || contract.data?.companyId !== companyId) {
    return { resolvedTax: null };
  }

  const date =
    contract.data.startDate ??
    datetime.today(await getCompanyTimeZone(client, companyId)).toString();
  const tax = await resolveLineTaxes(client, companyId, {
    source: "sales",
    customerId: contract.data.customerId,
    customerLocationId: contract.data.shipToCustomerLocationId,
    date
  });
  // Only a code (or an exemption) changes the default: with no code a new
  // line opens at 0%, as before tax codes.
  return {
    resolvedTax:
      tax.data && (tax.data.taxCodeId || tax.data.exempt)
        ? { taxCodeId: tax.data.taxCodeId, taxPercent: tax.data.taxPercent }
        : null
  };
}

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

  // The line's tax, for a caller that did not post the field (the form does;
  // an empty one is a cleared code): the ship-to's or the customer's code,
  // unless the item is not taxable. With no code the caller's own percent
  // stands, as before tax codes. The form types percent points; the resolver
  // gives a fraction.
  if (!formData.has("taxCodeId")) {
    const tax = await resolveLineTaxes(client, companyId, {
      source: "sales",
      customerId: contract.data.customerId,
      customerLocationId: contract.data.shipToCustomerLocationId,
      itemId: line.itemId,
      date: line.startDate
    });
    if (tax.data && (tax.data.taxCodeId || tax.data.exempt)) {
      line.taxCodeId = tax.data.taxCodeId ?? undefined;
      line.taxPercent = round(tax.data.taxPercent * 100);
    }
  }

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
        customerContractId: id,
        revenueType: "Recurring",
        itemId: "",
        description: "",
        quantity: 1,
        rate: 0,
        // Every billing frequency is also a rate unit.
        rateUnit: contract.billingFrequency ?? "Month",
        discountPercent: 0,
        // The form types percent points.
        taxPercent: round((resolvedTax?.taxPercent ?? 0) * 100),
        taxCodeId: resolvedTax?.taxCodeId ?? undefined,
        startDate: contract.startDate ?? "",
        revenueMethod: "Daily",
        projectId: contract.projectId ?? undefined
      }}
      currencyCode={contract.currencyCode}
      isLocked={contract.status !== "Draft"}
    />
  );
}
