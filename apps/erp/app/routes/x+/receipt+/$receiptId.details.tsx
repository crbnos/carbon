import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { Receipt, ReceiptLine } from "~/modules/inventory";
import {
  ReceiptForm,
  ReceiptLines,
  receiptValidator
} from "~/modules/inventory";
import { updateReceiptDetails } from "~/modules/inventory/inventory.server";
import { SupplierInteractionNotes } from "~/modules/purchasing/ui/SupplierInteraction";
import type { Note } from "~/modules/shared";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(receiptValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  // Shared with the inventory_upsertReceipt tool: a changed source document or
  // location rebuilds the receipt from the new source.
  const result = await updateReceiptDetails(client, {
    companyId,
    userId,
    receipt: { id, ...d, customFields: setCustomFields(formData) }
  });

  if (result.error) {
    if (
      result.error.flash === "Failed to load receipt" ||
      result.error.flash === "Failed to update receipt"
    ) {
      return data(
        {},
        await flash(
          request,
          error(result.error.cause ?? null, result.error.flash)
        )
      );
    }
    throw redirect(
      path.to.receipt(id),
      await flash(
        request,
        error(result.error.cause ?? null, result.error.flash)
      )
    );
  }

  throw redirect(
    path.to.receipt(id),
    await flash(request, success("Updated receipt"))
  );
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
      | "Inbound Transfer",
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
        // @ts-ignore
        initialValues={initialValues}
        status={routeData.receipt.status}
        receiptLines={routeData.receiptLines}
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
