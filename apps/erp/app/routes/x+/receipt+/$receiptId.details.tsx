import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { Receipt, ReceiptLine } from "~/modules/inventory";
import {
  ReceiptForm,
  ReceiptLines,
  getReceipt,
  receiptValidator,
  upsertReceipt,
} from "~/modules/inventory";
import { SupplierInteractionNotes } from "~/modules/purchasing/ui/SupplierInteraction";
import type { Note } from "~/modules/shared";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const formData = await request.formData();
  const validation = await validator(receiptValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const currentReceipt = await getReceipt(client, id);
  if (currentReceipt.error) {
    return json(
      {},
      await flash(
        request,
        error(currentReceipt.error, "Failed to load receipt")
      )
    );
  }

  const receiptDataHasChanged =
    currentReceipt.data.sourceDocument !== data.sourceDocument ||
    currentReceipt.data.sourceDocumentId !== data.sourceDocumentId ||
    currentReceipt.data.locationId !== data.locationId;

  if (receiptDataHasChanged) {
    const serviceRole = getCarbonServiceRole();
    switch (data.sourceDocument) {
      case "Purchase Order":
        const purchaseOrderReceipt = await serviceRole.functions.invoke<{
          id: string;
        }>("create", {
          body: {
            type: "receiptFromPurchaseOrder",
            companyId,
            locationId: data.locationId,
            purchaseOrderId: data.sourceDocumentId,
            receiptId: id,
            userId: userId,
          },
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

      case "Inbound Transfer":
        const warehouseTransferReceipt = await serviceRole.functions.invoke<{
          id: string;
        }>("create", {
          body: {
            type: "receiptFromInboundTransfer",
            companyId,
            warehouseTransferId: data.sourceDocumentId,
            receiptId: id,
            userId: userId,
          },
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
      ...data,
      updatedBy: userId,
      customFields: setCustomFields(formData),
    });

    if (updateReceipt.error) {
      return json(
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
    sourceDocument: (routeData.receipt.sourceDocument ??
      "Purchase Order") as "Purchase Order" | "Inbound Transfer",
    sourceDocumentId: routeData.receipt.sourceDocumentId ?? undefined,
    sourceDocumentReadableId:
      routeData.receipt.sourceDocumentReadableId ?? undefined,
    locationId: routeData.receipt.locationId ?? undefined,
    ...getCustomFields(routeData.receipt.customFields),
  };

  return (
    <div className="flex flex-col gap-2 pb-16 w-full">
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
    </div>
  );
}
