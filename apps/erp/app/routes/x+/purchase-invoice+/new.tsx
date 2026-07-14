import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import type { FunctionsResponse } from "@supabase/functions-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { useUrlParams, useUser } from "~/hooks";
import { upsertDocument } from "~/modules/documents";
import {
  createPurchaseInvoiceFromPurchaseOrder,
  getPurchaseInvoice,
  insertPurchaseInvoice,
  PurchaseInvoiceForm,
  purchaseInvoiceValidator,
  upsertPurchaseInvoiceLine
} from "~/modules/invoicing";
import { resolveItemIdFromExtractedText } from "~/modules/items";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

export const handle: Handle = {
  breadcrumb: msg`Purchasing`,
  to: path.to.purchasing,
  module: "purchasing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  // we don't use the client here -- if they have this permission, we'll upgrade to a service role if needed
  const { companyId, userId } = await requirePermissions(request, {
    create: "invoicing"
  });

  const url = new URL(request.url);
  const sourceDocument = url.searchParams.get("sourceDocument") ?? undefined;
  const sourceDocumentId = url.searchParams.get("sourceDocumentId") ?? "";

  let result: FunctionsResponse<{ id: string }>;

  switch (sourceDocument) {
    case "Purchase Order":
      if (!sourceDocumentId) throw new Error("Missing sourceDocumentId");
      result = await createPurchaseInvoiceFromPurchaseOrder(
        getCarbonServiceRole(),
        sourceDocumentId,
        companyId,
        userId
      );

      if (result.error || !result?.data) {
        throw redirect(
          request.headers.get("Referer") ?? path.to.purchaseOrders,
          await flash(
            request,
            error(result.error, "Failed to create purchase invoice")
          )
        );
      }

      throw redirect(path.to.purchaseInvoice(result.data?.id!));

    default:
      return null;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "invoicing"
    });

  const formData = await request.formData();
  const validation = await validator(purchaseInvoiceValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...d } = validation.data;

  const result = await insertPurchaseInvoice(client, {
    ...d,
    invoiceId: d.invoiceId || undefined,
    companyId,
    companyGroupId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.invoicingPurchasing,
      await flash(
        request,
        error(result.error, "Failed to insert purchase invoice")
      )
    );
  }

  const extractedLineItemsStr = formData.get("extractedLineItems") as string;
  let extractedLineItems: any[] = [];
  if (extractedLineItemsStr) {
    try {
      extractedLineItems = JSON.parse(extractedLineItemsStr);
    } catch {
      // ignore
    }
  }

  const extractedTaxAmountStr = formData.get("extractedTaxAmount") as string;
  const extractedTaxAmount = Number.parseFloat(extractedTaxAmountStr) || 0;

  const promises: Promise<any>[] = [];

  if (extractedLineItems.length > 0) {
    let taxApplied = false;

    for (const item of extractedLineItems) {
      if (!item.description && !item.partNumber) continue;

      const lineTax = !taxApplied ? extractedTaxAmount : 0;
      taxApplied = true;

      // Map the line up front when the extracted text directly matches an
      // existing record — only lines with no direct match are left as
      // comments for the review modal.
      const itemId = await resolveItemIdFromExtractedText(
        client,
        companyId,
        { type: "supplier", id: d.supplierId },
        [item.partNumber, item.description]
      );

      promises.push(
        upsertPurchaseInvoiceLine(client, {
          invoiceId: result.data.id,
          invoiceLineType: itemId ? "Part" : "Comment",
          itemId: itemId ?? undefined,
          description: item.partNumber || item.description || "Line Item",
          quantity: item.quantity || 1,
          supplierUnitPrice: item.unitPrice || 0,
          supplierShippingCost: 0,
          supplierTaxAmount: lineTax,
          locationId: d.locationId,
          companyId,
          createdBy: userId,
          customFields: {}
        })
      );
    }
  }

  const extractedStoragePath = formData.get("extractedStoragePath") as
    | string
    | undefined;

  const resultDataId = result.data.id;

  if (extractedStoragePath) {
    promises.push(
      (async () => {
        const fetchedInvoice = await getPurchaseInvoice(client, resultDataId);
        const interactionId = fetchedInvoice.data?.supplierInteractionId;

        if (interactionId) {
          const filenameParts = extractedStoragePath.split("/");
          const basename =
            filenameParts[filenameParts.length - 1] || "Extracted_Invoice.pdf";
          const originalFilename = basename.includes("_")
            ? basename.split("_").slice(1).join("_")
            : basename;
          const safeFilename = stripSpecialCharacters(originalFilename);
          const newStoragePath = `${companyId}/supplier-interaction/${interactionId}/${safeFilename}`;

          const copyResult = await client.storage
            .from("private")
            .copy(extractedStoragePath, newStoragePath);

          if (!copyResult.error) {
            await upsertDocument(client, {
              path: newStoragePath,
              name: originalFilename,
              size: 0,
              sourceDocument: "Purchase Invoice",
              sourceDocumentId: resultDataId,
              readGroups: [userId],
              writeGroups: [userId],
              createdBy: userId,
              companyId
            });
          }
        }
      })()
    );
  }

  if (promises.length > 0) {
    await Promise.all(promises);
  }

  throw redirect(path.to.purchaseInvoice(result.data.id));
}

export default function PurchaseInvoiceNewRoute() {
  const [params] = useUrlParams();
  const supplierId = params.get("supplierId");
  const { defaults } = useUser();

  const initialValues = {
    id: undefined,
    invoiceId: undefined,
    supplierId: supplierId ?? "",
    locationId: defaults?.locationId ?? "",
    dateIssued: today(getLocalTimeZone()).toString()
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <PurchaseInvoiceForm initialValues={initialValues} />
    </div>
  );
}
