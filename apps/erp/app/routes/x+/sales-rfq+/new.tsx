import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { useUrlParams, useUser } from "~/hooks";
import { upsertDocument } from "~/modules/documents";
import { resolveItemIdFromExtractedText } from "~/modules/items";
import type { SalesRFQStatusType } from "~/modules/sales";
import {
  getSalesRFQ,
  insertSalesRFQ,
  salesRfqValidator,
  upsertSalesRFQLine
} from "~/modules/sales";
import { SalesRFQForm } from "~/modules/sales/ui/SalesRFQ";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

export const handle: Handle = {
  breadcrumb: msg`RFQs`,
  to: path.to.salesRfqs
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(salesRfqValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await insertSalesRFQ(client, {
    ...validation.data,
    rfqId: validation.data.rfqId || undefined,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.salesRfqs,
      await flash(request, error(result.error, "Failed to insert RFQ"))
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

  const promises: Promise<any>[] = [];

  if (extractedLineItems.length > 0) {
    let order = 10;
    for (const item of extractedLineItems) {
      if (!item.partNumber && !item.description) continue;

      // Map the line up front when the extracted text directly matches an
      // existing record — only lines with no direct match are left unmapped
      // for the review modal.
      const itemId = await resolveItemIdFromExtractedText(
        client,
        companyId,
        { type: "customer", id: validation.data.customerId },
        [item.partNumber, item.description]
      );

      promises.push(
        upsertSalesRFQLine(client, {
          salesRfqId: result.data.id,
          customerPartId: item.partNumber || "Unknown",
          itemId: itemId ?? undefined,
          description: item.description || item.partNumber || "Line Item",
          quantity: [item.quantity || 1],
          unitOfMeasureCode: "EA",
          order: order,
          companyId,
          createdBy: userId,
          customFields: {}
        })
      );
      order += 10;
    }
  }

  const extractedStoragePath = formData.get("extractedStoragePath") as
    | string
    | undefined;

  const resultDataId = result.data.id;

  if (extractedStoragePath) {
    promises.push(
      (async () => {
        const fetchedRFQ = await getSalesRFQ(client, resultDataId);
        const opportunityId = fetchedRFQ.data?.opportunityId;

        if (opportunityId) {
          const filenameParts = extractedStoragePath.split("/");
          const basename =
            filenameParts[filenameParts.length - 1] || "Extracted_RFQ.pdf";
          const originalFilename = basename.includes("_")
            ? basename.split("_").slice(1).join("_")
            : basename;
          const safeFilename = stripSpecialCharacters(originalFilename);
          const newStoragePath = `${companyId}/opportunity/${opportunityId}/${safeFilename}`;

          const copyResult = await client.storage
            .from("private")
            .copy(extractedStoragePath, newStoragePath);

          if (!copyResult.error) {
            await upsertDocument(client, {
              path: newStoragePath,
              name: originalFilename,
              size: 0,
              sourceDocument: "Request for Quote",
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

  throw redirect(path.to.salesRfq(result.data.id));
}

export default function SalesRFQNewRoute() {
  const { id: userId, defaults } = useUser();
  const [params] = useUrlParams();
  const customerId = params.get("customerId");
  const initialValues = {
    customerContactId: "",
    customerLocationId: "",
    customerId: customerId ?? "",
    customerReference: "",
    expirationDate: "",
    id: undefined,
    locationId: defaults?.locationId ?? "",
    rfqDate: today(getLocalTimeZone()).toString(),
    rfqId: undefined,
    status: "Draft" as SalesRFQStatusType,
    salesPersonId: userId
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <SalesRFQForm initialValues={initialValues} />
    </div>
  );
}
