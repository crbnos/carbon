import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import { getSupabaseServiceRole } from "~/lib/supabase";
import type { Receipt, ReceiptLine } from "~/modules/inventory";
import {
  ReceiptForm,
  getReceipt,
  receiptValidator,
  upsertReceipt,
} from "~/modules/inventory";
import type { Note } from "~/modules/shared";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

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

  console.log("receiptDataHasChanged", receiptDataHasChanged);

  if (receiptDataHasChanged) {
    const serviceRole = getSupabaseServiceRole();
    switch (data.sourceDocument) {
      case "Purchase Order":
        const purchaseOrderReceipt = await serviceRole.functions.invoke<{
          id: string;
        }>("create-receipt-from-purchase-order", {
          body: {
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
      default:
        throw new Error("Unsupported source document");
    }
  }

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
      "Purchase Order") as "Purchase Order",
    sourceDocumentId: routeData.receipt.sourceDocumentId ?? undefined,
    sourceDocumentReadbleId:
      routeData.receipt.sourceDocumentReadableId ?? undefined,
    locationId: routeData.receipt.locationId ?? undefined,
    ...getCustomFields(routeData.receipt.customFields),
  };

  return (
    <ReceiptForm
      key={initialValues.receiptId}
      // @ts-ignore
      initialValues={initialValues}
      receiptLines={routeData.receiptLines}
    />
  );
}
