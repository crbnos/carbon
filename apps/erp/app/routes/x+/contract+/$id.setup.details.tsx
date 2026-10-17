// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect, round, tiptapToText } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import {
  contractDurationOf,
  customerContractValidator
} from "~/modules/sales/sales.models";
import type { ContractRouteData } from "~/modules/sales/ui/Contracts";
import { ContractDetailsForm } from "~/modules/sales/ui/Contracts";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

/** Saves a Draft's details from setup step 1 and moves on to Services. A
 *  different customer brings its own invoicing defaults: the bill-to,
 *  contact, addresses and payment terms of the old one would be wrong. */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(customerContractValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.sales.updateContractTerms({
    ...input.data,
    id,
    customFields: input.formData ? setCustomFields(input.formData) : undefined
  });
  if (!result.data) {
    return respond(args.request, result).redirect(
      result.error?.category === "notFound"
        ? path.to.contracts
        : path.to.contractSetup(id, "details"),
      { message: "" }
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
