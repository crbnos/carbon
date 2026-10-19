// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { dataOrThrow } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { RecordOutlet } from "@carbon/react";
import { getItemReadableId, redirect, round } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { Fragment } from "react/jsx-runtime";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { DeferredFiles } from "~/components";
import { salesInvoiceLineValidator } from "~/modules/invoicing/invoicing.models";
import SalesInvoiceLineForm from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceLineForm";
import {
  OpportunityLineDocuments,
  OpportunityLineNotes
} from "~/modules/sales/ui/Opportunity";
import { useItems } from "~/stores";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(
    request,
    { "invoicing.salesInvoices": "View" },
    { role: "employee" }
  );

  const { lineId } = params;
  if (!lineId) throw notFound("lineId not found");

  const salesInvoiceLine = await api.invoicing.getSalesInvoiceLine({
    salesInvoiceLineId: lineId
  });

  const itemId = salesInvoiceLine?.data?.itemId;

  return {
    salesInvoiceLine: salesInvoiceLine?.data ?? null,
    files: api.sales
      .getOpportunityLineDocuments({ lineId, itemId })
      .then(dataOrThrow)
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesInvoiceLineValidator).request(args, {
    params: ["invoiceId", "lineId"]
  });
  if ("invalid" in input) return input.invalid;
  const { invoiceId, lineId } = input.params;
  const formData = input.formData ?? new FormData();
  const { api } = await authorize(args.request);
  const result = await api.invoicing.updateSalesInvoiceLine({
    ...input.data,
    id: lineId,
    invoiceId,
    customFields: setCustomFields(formData),
    acknowledged: formData.get("acknowledged") === "true"
  });
  // An error is toasted; the violation modal reads `violations`.
  if (!result.data) return result;
  if ("violations" in result.data) return result.data;
  throw redirect(path.to.salesInvoiceLine(invoiceId, lineId));
}

export default function EditSalesInvoiceLineRoute() {
  const { t } = useLingui();
  const { invoiceId, lineId } = useParams();
  if (!invoiceId) throw notFound("invoiceId not found");
  if (!lineId) throw notFound("lineId not found");

  const { salesInvoiceLine, files } = useLoaderData<typeof loader>();

  const initialValues = {
    id: salesInvoiceLine?.id ?? undefined,
    invoiceId: salesInvoiceLine?.invoiceId ?? "",
    invoiceLineType: (salesInvoiceLine?.invoiceLineType ?? "Part") as "Part",
    methodType: (salesInvoiceLine?.methodType ??
      "Pull from Inventory") as "Pull from Inventory",
    itemId: salesInvoiceLine?.itemId ?? "",
    accountId: salesInvoiceLine?.accountId ?? "",
    addOnCost: salesInvoiceLine?.addOnCost ?? 0,
    nonTaxableAddOnCost: salesInvoiceLine?.nonTaxableAddOnCost ?? 0,
    assetId: salesInvoiceLine?.assetId ?? "",
    description: salesInvoiceLine?.description ?? "",
    quantity: salesInvoiceLine?.quantity ?? 1,
    unitPrice: salesInvoiceLine?.unitPrice ?? 0,
    discountPercent: round((salesInvoiceLine?.discountPercent ?? 0) * 100),
    shippingCost: salesInvoiceLine?.shippingCost ?? 0,
    taxPercent: salesInvoiceLine?.taxPercent ?? 0,
    exchangeRate: salesInvoiceLine?.exchangeRate ?? 1,
    unitOfMeasureCode: salesInvoiceLine?.unitOfMeasureCode ?? "",
    storageUnitId: salesInvoiceLine?.storageUnitId ?? "",
    serviceStartDate: salesInvoiceLine?.serviceStartDate ?? "",
    serviceEndDate: salesInvoiceLine?.serviceEndDate ?? "",
    assetReadableId: (salesInvoiceLine as any)?.assetReadableId ?? undefined,
    assetName: (salesInvoiceLine as any)?.assetName ?? undefined,
    ...getCustomFields(salesInvoiceLine?.customFields)
  };

  const [items] = useItems();

  return (
    <Fragment key={salesInvoiceLine?.id}>
      <SalesInvoiceLineForm
        key={initialValues.id}
        initialValues={initialValues}
        isSalesOrderLine={salesInvoiceLine?.salesOrderLineId !== undefined}
      />
      <OpportunityLineNotes
        id={salesInvoiceLine?.id ?? ""}
        table="salesInvoiceLine"
        title={t`Notes`}
        subTitle={getItemReadableId(items, salesInvoiceLine?.itemId) ?? ""}
        internalNotes={salesInvoiceLine?.internalNotes as JSONContent}
      />

      <DeferredFiles resolve={files}>
        {(resolvedFiles) => (
          <OpportunityLineDocuments
            files={resolvedFiles ?? []}
            id={invoiceId}
            lineId={lineId}
            itemId={salesInvoiceLine?.itemId}
            type="Sales Invoice"
          />
        )}
      </DeferredFiles>

      <RecordOutlet />
    </Fragment>
  );
}
