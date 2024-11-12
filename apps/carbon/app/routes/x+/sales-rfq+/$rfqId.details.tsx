import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
  VStack,
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Await, useParams } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { Suspense } from "react";
import { useRouteData } from "~/hooks";
import type {
  Opportunity,
  SalesRFQ,
  SalesRFQLine,
  SalesRFQStatusType,
} from "~/modules/sales";
import {
  OpportunityDocuments,
  OpportunityNotes,
  OpportunityState,
  SalesRFQForm,
  salesRfqValidator,
  upsertSalesRFQ,
} from "~/modules/sales";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

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
    files: Promise<FileObject[]>;
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
    salesPersonId: rfqData?.rfqSummary?.salesPersonId ?? "",

    ...getCustomFields(rfqData.rfqSummary?.customFields ?? {}),
  };

  return (
    <VStack spacing={2}>
      <OpportunityState
        key={`state-${initialValues.id}`}
        opportunity={rfqData?.opportunity!}
      />
      <SalesRFQForm
        key={`${initialValues.id}:${initialValues.status}`}
        initialValues={initialValues}
      />
      <Suspense
        key={`documents-${rfqId}`}
        fallback={
          <Card>
            <CardHeader>
              <CardTitle>Files</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="min-h-[100px] flex items-center justify-center">
                <Spinner />
              </div>
            </CardContent>
          </Card>
        }
      >
        <Await resolve={rfqData.files}>
          {(resolvedFiles) => (
            <OpportunityDocuments
              opportunity={rfqData.opportunity}
              attachments={resolvedFiles}
              id={rfqId}
              type="Request for Quote"
            />
          )}
        </Await>
      </Suspense>
      <OpportunityNotes
        key={`notes-${rfqId}`}
        id={rfqData.rfqSummary.id}
        table="salesRfq"
        internalNotes={rfqData.rfqSummary.internalNotes as JSONContent}
        externalNotes={rfqData.rfqSummary.externalNotes as JSONContent}
      />
    </VStack>
  );
}
