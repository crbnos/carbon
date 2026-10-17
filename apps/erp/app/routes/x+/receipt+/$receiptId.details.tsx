// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { receiptValidator } from "~/modules/inventory/inventory.models";
import type { Receipt, ReceiptLine } from "~/modules/inventory/types";
import { ReceiptForm, ReceiptLines } from "~/modules/inventory/ui";
import { SupplierInteractionNotes } from "~/modules/purchasing/ui/SupplierInteraction";
import type { Note } from "~/modules/shared/types";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(receiptValidator).request(args, {
    params: ["receiptId"]
  });
  if ("invalid" in input) return input.invalid;
  const { receiptId } = input.params;
  const api = await carbon(args.request);
  const result = await api.inventory.updateReceipt({
    ...input.data,
    // The document in the URL is the one updated, whatever the form's id says.
    id: receiptId,
    customFields: input.formData && setCustomFields(input.formData)
  });
  return respond(args.request, result).redirect(path.to.receipt(receiptId), {
    message: "Updated receipt"
  });
}

export default function ReceiptDetailsRoute() {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("Could not find receiptId");

  const routeData = useRouteData<{
    receipt: Receipt;
    receiptLines: ReceiptLine[];
    notes: Note[];
  }>(path.to.receipt(receiptId));

  if (!routeData?.receipt)
    throw new Error("Could not find receipt in routeData");

  const initialValues = {
    ...routeData.receipt,
    receiptId: routeData.receipt.receiptId ?? undefined,
    externalDocumentId: routeData.receipt.externalDocumentId ?? undefined,
    sourceDocument: (routeData.receipt.sourceDocument ?? "Purchase Order") as
      | "Purchase Order"
      | "Inbound Transfer"
      | "Rental Agreement",
    sourceDocumentId: routeData.receipt.sourceDocumentId ?? undefined,
    sourceDocumentReadableId:
      routeData.receipt.sourceDocumentReadableId ?? undefined,
    locationId: routeData.receipt.locationId ?? undefined,
    ...getCustomFields(routeData.receipt.customFields)
  };

  return (
    <>
      <ReceiptForm
        key={initialValues.sourceDocumentId}
        // @ts-expect-error
        initialValues={initialValues}
        status={routeData.receipt.status}
      />

      <ReceiptLines />

      <SupplierInteractionNotes
        key={`notes-${initialValues.id}`}
        id={receiptId}
        title="Notes"
        table="receipt"
        internalNotes={routeData.receipt.internalNotes as JSONContent}
      />
    </>
  );
}
