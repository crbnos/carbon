import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Editor,
  generateHTML,
  toast,
  useThrottle,
  VStack,
} from "@carbon/react";
import { validationError, validator } from "@carbon/remix-validated-form";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import { nanoid } from "nanoid";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { SalesRFQ, SalesRFQLine, SalesRFQStatus } from "~/modules/sales";
import {
  SalesRFQDocuments,
  SalesRFQForm,
  salesRfqValidator,
  upsertSalesRFQ,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

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
  }>(path.to.salesRfq(rfqId));

  if (!rfqData) throw new Error("Could not find rfq data");

  const initialValues = {
    customerContactId: rfqData?.rfqSummary?.customerContactId ?? "",
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
    status: rfqData?.rfqSummary?.status ?? ("Draft" as SalesRFQStatus),
    ...getCustomFields(rfqData.rfqSummary?.customFields ?? {}),
  };

  return (
    <VStack spacing={2}>
      <SalesRFQForm
        key={`${initialValues.id}:${initialValues.status}`}
        initialValues={initialValues}
      />
      <SalesRFQDocuments id={rfqId} attachments={rfqData?.files ?? []} />
      <SalesRFQNotes salesRfq={rfqData.rfqSummary} />
    </VStack>
  );
}

const SalesRFQNotes = ({ salesRfq }: { salesRfq: SalesRFQ }) => {
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();
  const { supabase } = useSupabase();
  const permissions = usePermissions();

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/sales-rfq/${
      salesRfq.id
    }/${nanoid()}.${fileType}`;

    const result = await supabase?.storage
      .from("private")
      .upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return `/file/preview/private/${result.data.path}`;
  };

  const onUpdateExternalNotes = useThrottle(async (content: JSONContent) => {
    console.log({ content });
    await supabase
      ?.from("salesRfq")
      .update({
        externalNotes: content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", salesRfq.id!);
  }, 2500);

  return (
    <Card>
      <CardHeader>
        <CardTitle>External Notes</CardTitle>
      </CardHeader>
      <CardContent>
        {permissions.can("update", "sales") ? (
          <Editor
            initialValue={(salesRfq.notes ?? {}) as JSONContent}
            onUpload={onUploadImage}
            onChange={onUpdateExternalNotes}
          />
        ) : (
          <div
            className="prose dark:prose-invert"
            dangerouslySetInnerHTML={{
              __html: generateHTML(salesRfq.notes as JSONContent),
            }}
          />
        )}
      </CardContent>
    </Card>
  );
};
