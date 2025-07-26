import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Spinner } from "@carbon/react";
import { Await, Outlet, useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { Fragment, Suspense } from "react";
import { CadModel } from "~/components";
import { usePermissions } from "~/hooks";
import {
  getOpportunityLineDocuments,
  getSalesRFQLine,
  salesRfqLineValidator,
  upsertSalesRFQLine,
} from "~/modules/sales";
import {
  OpportunityLineDocuments,
  OpportunityLineNotes,
} from "~/modules/sales/ui/Opportunity";
import { SalesRFQLineForm } from "~/modules/sales/ui/SalesRFQ";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { rfqId, lineId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");
  if (!lineId) throw new Error("Could not find lineId");

  const serviceRole = await getCarbonServiceRole();

  const [line] = await Promise.all([getSalesRFQLine(serviceRole, lineId)]);

  if (line.error) {
    throw redirect(
      path.to.quote(rfqId),
      await flash(request, error(line.error, "Failed to load line"))
    );
  }

  const itemId = line.data.itemId;

  return defer({
    line: line.data,
    files: getOpportunityLineDocuments(serviceRole, companyId, lineId, itemId),
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
      <OpportunityLineNotes
        id={line.id}
        table="salesRfqLine"
        title="Notes"
        subTitle={line.customerPartId ?? ""}
        internalNotes={line.internalNotes as JSONContent}
        externalNotes={line.externalNotes as JSONContent}
      />

      <Suspense
        fallback={
          <div className="flex w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
            <Spinner className="h-10 w-10" />
          </div>
        }
      >
        <Await resolve={files}>
          {(resolvedFiles) => (
            <OpportunityLineDocuments
              files={resolvedFiles ?? []}
              id={rfqId}
              lineId={lineId}
              itemId={line?.itemId}
              modelUpload={line ?? undefined}
              type="Request for Quote"
            />
          )}
        </Await>
      </Suspense>
      <CadModel
        isReadOnly={!permissions.can("update", "sales")}
        metadata={{
          salesRfqLineId: line.id ?? undefined,
          itemId: line.itemId ?? undefined,
        }}
        modelPath={line?.modelPath ?? null}
        title="CAD Model"
        uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
        viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
      />

      <Outlet />
    </Fragment>
  );
}
