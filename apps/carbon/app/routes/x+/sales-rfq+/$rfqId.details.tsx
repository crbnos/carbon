import { assertIsPost, error, success, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Editor,
  generateHTML,
  HStack,
  toast,
  useThrottle,
  VStack,
} from "@carbon/react";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { useParams } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { nanoid } from "nanoid";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type {
  Opportunity,
  SalesRFQ,
  SalesRFQLine,
  SalesRFQStatusType,
} from "~/modules/sales";
import {
  OpportunityDocuments,
  SalesRFQForm,
  salesRfqValidator,
  upsertSalesRFQ,
} from "~/modules/sales";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getPrivateUrl, path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const { rfqId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(salesRfqValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { rfqId, ...data } = validation.data;
  if (!rfqId) throw new Error("Could not find rfqId");

  const update = await upsertSalesRFQ(client, {
    id,
    rfqId,
    ...data,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (update.error) {
    throw redirect(
      path.to.salesRfq(id),
      await flash(request, error(update.error, "Failed to update RFQ"))
    );
  }

  throw redirect(
    path.to.salesRfq(id),
    await flash(request, success("Updated RFQ"))
  );
}

export default function SalesRFQDetailsRoute() {
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("Could not find rfqId");

  const rfqData = useRouteData<{
    rfqSummary: SalesRFQ;
    lines: SalesRFQLine[];
    files: FileObject[];
    opportunity: Opportunity;
  }>(path.to.salesRfq(rfqId));

  if (!rfqData) throw new Error("Could not find rfq data");

  const initialValues = {
    customerContactId: rfqData?.rfqSummary?.customerContactId ?? "",
    customerLocationId: rfqData?.rfqSummary?.customerLocationId ?? "",
    customerId: rfqData?.rfqSummary?.customerId ?? "",
    customerReference: rfqData?.rfqSummary?.customerReference ?? "",
    expirationDate: rfqData?.rfqSummary?.expirationDate
      ? parseDate(rfqData?.rfqSummary?.expirationDate).toString()
      : "",
    id: rfqData?.rfqSummary?.id ?? "",
    locationId: rfqData?.rfqSummary?.locationId ?? "",
    rfqDate: rfqData?.rfqSummary?.rfqDate
      ? parseDate(rfqData?.rfqSummary?.rfqDate).toString()
      : "",
    rfqId: rfqData?.rfqSummary?.rfqId ?? "",
    status: rfqData?.rfqSummary?.status ?? ("Draft" as SalesRFQStatusType),
    ...getCustomFields(rfqData.rfqSummary?.customFields ?? {}),
  };

  return (
    <VStack spacing={2}>
      <SalesRFQForm
        key={`${initialValues.id}:${initialValues.status}`}
        initialValues={initialValues}
      />
      <OpportunityDocuments
        opportunity={rfqData?.opportunity!}
        attachments={rfqData?.files ?? []}
        id={rfqId}
        type="Request for Quote"
      />
      <SalesRFQNotes salesRfq={rfqData.rfqSummary} />
    </VStack>
  );
}

const SalesRFQNotes = ({ salesRfq }: { salesRfq: SalesRFQ }) => {
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/opportunity/${
      salesRfq.id
    }/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  const onUpdateExternalNotes = useThrottle(async (content: JSONContent) => {
    await carbon
      ?.from("salesRfq")
      .update({
        externalNotes: content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", salesRfq.id!);
  }, 2500);

  const onUpdateInternalNotes = useThrottle(async (content: JSONContent) => {
    await carbon
      ?.from("salesRfq")
      .update({
        internalNotes: content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", salesRfq.id!);
  }, 2500);

  return (
    <HStack className="w-full justify-between items-stretch">
      <Card>
        <CardHeader>
          <CardTitle>External Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {permissions.can("update", "sales") ? (
            <Editor
              initialValue={(salesRfq.externalNotes ?? {}) as JSONContent}
              onUpload={onUploadImage}
              onChange={onUpdateExternalNotes}
            />
          ) : (
            <div
              className="prose dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: generateHTML(salesRfq.externalNotes as JSONContent),
              }}
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Internal Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {permissions.can("update", "sales") ? (
            <Editor
              initialValue={(salesRfq.internalNotes ?? {}) as JSONContent}
              onUpload={onUploadImage}
              onChange={onUpdateInternalNotes}
            />
          ) : (
            <div
              className="prose dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: generateHTML(salesRfq.internalNotes as JSONContent),
              }}
            />
          )}
        </CardContent>
      </Card>
    </HStack>
  );
};
