import { VStack } from "@carbon/react";
import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getQuoteLine, QuoteLineForm } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { client } = await requirePermissions(request, {
    view: "sales",
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const [line] = await Promise.all([getQuoteLine(client, lineId)]);

  if (line.error) {
    throw redirect(
      path.to.quote(quoteId),
      await flash(request, error(line.error, "Failed to load line"))
    );
  }

  return json({
    line: line.data,
  });
};

export default function QuoteLine() {
  const { line } = useLoaderData<typeof loader>();
  const initialValues = {
    ...line,
    id: line.id ?? undefined,
    quoteId: line.quoteId ?? "",
    estimatorId: line.estimatorId ?? "",
    customerPartId: line.customerPartId ?? "",
    customerPartRevision: line.customerPartRevision ?? "",
    status: line.status ?? "Draft",
    itemId: line.itemId ?? "",
    itemReadableId: line.itemReadableId ?? "",
    description: line.description ?? "",
    methodType: line.methodType ?? "Make",
    unitOfMeasureCode: line.unitOfMeasureCode ?? "",
    modelUploadId: line.modelUploadId ?? undefined,
  };

  return (
    <VStack spacing={2} className="p-2">
      <QuoteLineForm initialValues={initialValues} />
    </VStack>
  );
}
