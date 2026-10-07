// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import { redirect, round, tiptapToText } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { getExchangeRate } from "~/modules/accounting";
import {
  customerContractValidator,
  getContract,
  updateContract
} from "~/modules/sales";
import { contractCustomerChange } from "~/modules/sales/sales.server";
import type { ContractRouteData } from "~/modules/sales/ui/Contracts";
import {
  ContractDetailsForm,
  contractDurationOf
} from "~/modules/sales/ui/Contracts";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

/** Saves a Draft's details from setup step 1 and moves on to Services. A
 *  different customer brings its own invoicing defaults: the bill-to,
 *  contact, addresses and payment terms of the old one would be wrong. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const current = await getContract(client, id, companyId);
  if (current.error || current.data?.companyId !== companyId) {
    throw redirect(
      path.to.contracts,
      await flash(request, error(current.error, "Contract not found"))
    );
  }

  const formData = await request.formData();
  const validation = await validator(customerContractValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    id: _id,
    customerContractId: _customerContractId,
    ...data
  } = validation.data;

  const invoicing = await contractCustomerChange(client, companyId, {
    from: current.data.customerId,
    to: data.customerId
  });

  let exchangeRate: number | undefined;
  if (data.currencyCode !== current.data.currencyCode) {
    const rate = await getExchangeRate(client, companyId, data.currencyCode);
    if (rate.error || !rate.data) {
      throw redirect(
        path.to.contractSetup(id, "details"),
        await flash(
          request,
          error(rate.error, "Failed to get the exchange rate")
        )
      );
    }
    exchangeRate = Number(rate.data);
  }

  // Refuses a contract that is no longer a Draft.
  const update = await updateContract(client, {
    ...data,
    ...(invoicing ?? {}),
    ...(exchangeRate !== undefined ? { exchangeRate } : {}),
    id,
    updatedBy: userId,
    // Merged, so a field the form did not render is kept.
    customFields: {
      ...((current.data.customFields ?? {}) as Record<string, unknown>),
      ...setCustomFields(formData)
    } as Json
  });
  if (update.error) {
    throw redirect(
      path.to.contractSetup(id, "details"),
      await flash(
        request,
        error(update.error, update.error.message || "Failed to update contract")
      )
    );
  }

  throw redirect(path.to.contractSetup(id, "products"));
}

export default function ContractSetupDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<ContractRouteData>(path.to.contract(id));
  if (!routeData) return null;
  const { contract } = routeData;

  return (
    <ContractDetailsForm
      key={contract.updatedAt ?? id}
      action={path.to.contractSetup(id, "details")}
      initialValues={{
        id,
        customerContractId: contract.customerContractId ?? undefined,
        name: contract.name ?? "",
        contractType: contract.contractType ?? undefined,
        customerId: contract.customerId ?? "",
        invoiceCustomerId: contract.invoiceCustomerId ?? undefined,
        invoiceCustomerContactId:
          contract.invoiceCustomerContactId ?? undefined,
        invoiceCustomerLocationId:
          contract.invoiceCustomerLocationId ?? undefined,
        shipToCustomerLocationId:
          contract.shipToCustomerLocationId ?? undefined,
        salesPersonId: contract.salesPersonId ?? undefined,
        projectId: contract.projectId ?? undefined,
        customerReference: contract.customerReference ?? undefined,
        closeDate: contract.closeDate ?? "",
        startDate: contract.startDate ?? "",
        duration: contractDurationOf({
          endDate: contract.endDate,
          termMonths: contract.termMonths
        }),
        endDate: contract.endDate ?? undefined,
        renewal: contract.renewal ?? "Renew",
        // Stored as a fraction; the form speaks percent points.
        renewalUplift: round(Number(contract.renewalUplift ?? 0) * 100),
        billingFrequency: contract.billingFrequency ?? "Month",
        billingAlignment: contract.billingAlignment ?? "Anniversary",
        billingTiming: contract.billingTiming ?? "Advance",
        firstInvoiceDate: contract.firstInvoiceDate ?? undefined,
        billedThrough: contract.billedThrough ?? undefined,
        recognizeRevenueFrom: contract.recognizeRevenueFrom ?? undefined,
        invoiceAutomation: contract.invoiceAutomation ?? undefined,
        paymentTermId: contract.paymentTermId ?? undefined,
        currencyCode: contract.currencyCode,
        notes:
          tiptapToText(
            (contract.notes ?? null) as Parameters<typeof tiptapToText>[0]
          ) || undefined,
        ...getCustomFields(contract.customFields)
      }}
    />
  );
}
