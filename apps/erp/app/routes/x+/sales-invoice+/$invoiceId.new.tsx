// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { useRouteData } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useUser } from "~/hooks";
import { salesInvoiceLineValidator } from "~/modules/invoicing/invoicing.models";
import type { SalesInvoice } from "~/modules/invoicing/types";
import SalesInvoiceLineForm from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceLineForm";
import type { MethodItemType } from "~/modules/shared/types";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesInvoiceLineValidator).request(args, {
    params: ["invoiceId"]
  });
  if ("invalid" in input) return input.invalid;
  const { invoiceId } = input.params;
  const formData = input.formData ?? new FormData();
  const api = await carbon(args.request);
  const result = await api.invoicing.createSalesInvoiceLine({
    ...input.data,
    // The URL invoice, not the form's copy.
    invoiceId,
    customFields: setCustomFields(formData),
    acknowledged: formData.get("acknowledged") === "true"
  });
  // An error is toasted; the violation modal reads `violations`.
  if (!result.data) return result;
  if ("violations" in result.data) return result.data;
  throw redirect(path.to.salesInvoiceDetails(invoiceId));
}

export default function NewSalesInvoiceLineRoute() {
  const { defaults } = useUser();
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("Could not find sales invoice id");
  const salesInvoiceData = useRouteData<{
    salesInvoice: SalesInvoice;
  }>(path.to.salesInvoice(invoiceId));

  if (!invoiceId) throw new Error("Could not find sales invoice id");

  const initialValues = {
    invoiceId: invoiceId,
    // "Item" is the picker's generic mode, not a member of the line-type
    // enum; posting it failed validation with "Type is required".
    invoiceLineType: "Part" as MethodItemType,
    quantity: 1,
    unitOfMeasureCode: "EA",
    locationId:
      salesInvoiceData?.salesInvoice?.locationId ?? defaults.locationId ?? "",
    unitPrice: 0,
    discountPercent: 0,
    shippingCost: 0,
    addOnCost: 0,
    nonTaxableAddOnCost: 0,
    taxPercent: 0,
    exchangeRate: salesInvoiceData?.salesInvoice?.exchangeRate ?? 1,
    serviceStartDate: "",
    serviceEndDate: ""
  };

  return <SalesInvoiceLineForm initialValues={initialValues} />;
}
