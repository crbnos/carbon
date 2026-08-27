import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { Receipt, ReceiptLine } from "~/modules/inventory";
import {
  getReceipt,
  ReceiptForm,
  ReceiptLines,
  receiptValidator,
  upsertReceipt
} from "~/modules/inventory";
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

  const currentReceipt = await getReceipt(client, id);
  if (currentReceipt.error) {
    return data(
      {},
      await flash(
        request,
        error(currentReceipt.error, "Failed to load receipt")
      )
    );
  }

  const receiptDataHasChanged =
    currentReceipt.data.sourceDocument !== d.sourceDocument ||
    currentReceipt.data.sourceDocumentId !== d.sourceDocumentId ||
    currentReceipt.data.locationId !== d.locationId;

  if (receiptDataHasChanged) {
    const serviceRole = getCarbonServiceRole();
    switch (d.sourceDocument) {
      case "Purchase Order":
        const purchaseOrderReceipt = await serviceRole.functions.invoke<{
          id: string;
        }>("create", {
          body: {
            type: "receiptFromPurchaseOrder",
            companyId,
            locationId: d.locationId,
            purchaseOrderId: d.sourceDocumentId,
            receiptId: id,
            userId: userId
          }
        });
        if (!purchaseOrderReceipt.data || purchaseOrderReceipt.error) {
          throw redirect(
            path.to.receipt(id),
            await flash(
              request,
              error(purchaseOrderReceipt.error, "Failed to create receipt")
            )
          );
        }
        break;

      case "Sales Return Order":
        const salesReturnOrderReceipt = await serviceRole.functions.invoke<{
          id: string;
        }>("create", {
          body: {
            type: "receiptFromSalesReturnOrder",
            companyId,
            locationId: d.locationId,
            salesReturnOrderId: d.sourceDocumentId,
            receiptId: id,
            userId: userId
          }
        });
        if (!salesReturnOrderReceipt.data || salesReturnOrderReceipt.error) {
          throw redirect(
            path.to.receipt(id),
            await flash(
              request,
              error(salesReturnOrderReceipt.error, "Failed to create receipt")
            )
          );
        }
        break;

      case "Inbound Transfer":
        const warehouseTransferReceipt = await serviceRole.functions.invoke<{
          id: string;
        }>("create", {
          body: {
            type: "receiptFromInboundTransfer",
            companyId,
            warehouseTransferId: d.sourceDocumentId,
            receiptId: id,
            userId: userId
          }
        });
        if (!warehouseTransferReceipt.data || warehouseTransferReceipt.error) {
          throw redirect(
            path.to.receipt(id),
            await flash(
              request,
              error(warehouseTransferReceipt.error, "Failed to create receipt")
            )
          );
        }
        break;

      default:
        throw new Error("Unsupported source document");
    }
  } else {
    const updateReceipt = await upsertReceipt(client, {
      id,
      ...d,
      updatedBy: userId,
      customFields: setCustomFields(formData)
    });

    if (updateReceipt.error) {
      return data(
        {},
        await flash(
          request,
          error(updateReceipt.error, "Failed to update receipt")
        )
      );
    }
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
