import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import { validationError, validator } from "@carbon/remix-validated-form";
import { parseDate } from "@internationalized/date";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { ModelUpload } from "~/modules/items";
import type { SalesRFQ, SalesRFQStatus } from "~/modules/sales";
import {
  SalesRFQForm,
  getSalesRFQLines,
  salesRfqValidator,
  upsertSalesRFQ,
} from "~/modules/sales";
import SalesRFQLines from "~/modules/sales/ui/SalesRFQ/SalesRFQLines";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");

  const lines = await getSalesRFQLines(client, rfqId);
  if (lines.error) {
    throw redirect(
      path.to.salesRfqs,
      await flash(request, error(lines.error, "Failed to load RFQ lines"))
    );
  }

  return json({
    lines: lines.data.map((line) => ({
      ...line,
      customerRevisionId: line.customerRevisionId ?? "",
      description: line.description ?? "",
      externalNotes: (line.externalNotes ?? {}) as JSONContent,
      internalNotes: (line.internalNotes ?? {}) as JSONContent,
      itemId: line.itemId ?? "",
      quantity: line.quantity ?? [1],
    })) ?? [1],
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
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

  const { lines } = useLoaderData<typeof loader>();

  const rfqData = useRouteData<{
    rfqSummary: SalesRFQ;
    modelUploads?: ModelUpload[];
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
    <VStack spacing={2} className="p-2">
      <SalesRFQForm key={initialValues.id} initialValues={initialValues} />
      <SalesRFQLines lines={lines} />
    </VStack>
  );
}
