import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData, useParams } from "@remix-run/react";
import { Fragment } from "react";
import { usePermissions } from "~/hooks";
import {
  getOpportunityLineDocuments,
  getSalesRFQLine,
  OpportunityLineDocuments,
  SalesRFQLineForm,
  SalesRFQLineNotes,
  salesRfqLineValidator,
  upsertSalesRFQLine,
} from "~/modules/sales";
import { CadModel } from "~/modules/shared";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { rfqId, lineId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");
  if (!lineId) throw new Error("Could not find lineId");

  const [line, files] = await Promise.all([
    getSalesRFQLine(client, lineId),
    getOpportunityLineDocuments(client, companyId, lineId),
  ]);

  if (line.error) {
    throw redirect(
      path.to.quote(rfqId),
      await flash(request, error(line.error, "Failed to load line"))
    );
  }

  return json({
    line: line.data,
    files: files?.data ?? [],
  });
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { rfqId, lineId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();

  const validation = await validator(salesRfqLineValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const updateLine = await upsertSalesRFQLine(client, {
    id: lineId,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateLine.error) {
    throw redirect(
      path.to.salesRfqLine(rfqId, lineId),
      await flash(
        request,
        error(updateLine.error, "Failed to update quote line")
      )
    );
  }

  throw redirect(path.to.salesRfqLine(rfqId, lineId));
}

export default function SalesRFQLine() {
  const { line, files } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const { rfqId, lineId } = useParams();
  if (!rfqId) throw new Error("Could not find rfqId");
  if (!lineId) throw new Error("Could not find lineId");

  const initialValues = {
    ...line,
    id: line.id ?? undefined,
    salesRfqId: line.salesRfqId ?? "",
    customerPartId: line.customerPartId ?? "",
    customerPartRevision: line.customerPartRevision ?? "",
    description: line.description ?? "",
    itemId: line.itemId ?? "",
    quantity: line.quantity ?? [1],
    order: line.order ?? 1,
    unitOfMeasureCode: line.unitOfMeasureCode ?? "",
    modelUploadId: line.modelUploadId ?? undefined,
  };

  return (
    <Fragment key={lineId}>
      <SalesRFQLineForm key={lineId} initialValues={initialValues} />

      <div className="grid grid-cols-1 xl:grid-cols-2 w-full flex-grow gap-2 ">
        <CadModel
          autodeskUrn={line?.autodeskUrn ?? null}
          isReadOnly={!permissions.can("update", "sales")}
          metadata={{ salesRfqLineId: line.id ?? undefined }}
          modelPath={line?.modelPath ?? null}
          title="CAD Model"
          uploadClassName="min-h-[360px]"
          viewerClassName="min-h-[360px]"
        />
        <OpportunityLineDocuments
          files={files ?? []}
          id={rfqId}
          lineId={lineId}
          modelUpload={line ?? undefined}
          type="Request for Quote"
        />
      </div>
      <SalesRFQLineNotes line={line} />

      <Outlet />
    </Fragment>
  );
}
