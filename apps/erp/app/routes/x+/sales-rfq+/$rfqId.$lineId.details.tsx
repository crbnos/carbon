import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { Fragment } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useParams } from "react-router";
import { CadModel, DeferredFiles } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { SalesRFQ } from "~/modules/sales";
import {
  getOpportunityLineDocuments,
  getSalesRFQ,
  getSalesRFQLine,
  isSalesRfqLocked,
  salesRfqLineValidator,
  upsertSalesRFQLine
} from "~/modules/sales";
import {
  OpportunityLineDocuments,
  OpportunityLineNotes
} from "~/modules/sales/ui/Opportunity";
import { SalesRFQLineForm } from "~/modules/sales/ui/SalesRFQ";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { rfqId, lineId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");
  if (!lineId) throw new Error("Could not find lineId");

  const serviceRole = await getCarbonServiceRole();

  const line = await getSalesRFQLine(serviceRole, lineId);

  if (line.error) {
    throw redirect(
      path.to.salesRfq(rfqId),
      await flash(request, error(line.error, "Failed to load line"))
    );
  }

  const itemId = line.data.itemId;

  return {
    line: line.data,
    files: getOpportunityLineDocuments(serviceRole, companyId, lineId, itemId)
  };
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { rfqId, lineId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");
  if (!lineId) throw new Error("Could not find lineId");

  const { client: viewClient } = await requirePermissions(request, {
    view: "sales"
  });

  const rfq = await getSalesRFQ(viewClient, rfqId);
  await requireUnlocked({
    request,
    isLocked: isSalesRfqLocked(rfq.data?.status),
    redirectTo: path.to.salesRfqLine(rfqId, lineId),
    message: "Cannot modify a locked RFQ. Reopen it first."
  });

  const { client, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();

  const validation = await validator(salesRfqLineValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const updateLine = await upsertSalesRFQLine(client, {
    id: lineId,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
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
  const { t } = useLingui();
  const { line, files } = useLoaderData<typeof loader>();

  const permissions = usePermissions();

  const { rfqId, lineId } = useParams();
  if (!rfqId) throw new Error("Could not find rfqId");
  if (!lineId) throw new Error("Could not find lineId");

  const rfqData = useRouteData<{
    rfqSummary: SalesRFQ;
  }>(path.to.salesRfq(rfqId));

  const isReadOnly = isSalesRfqLocked(rfqData?.rfqSummary?.status);

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
    modelUploadId: line.modelUploadId ?? undefined
  };

  return (
    <Fragment key={lineId}>
      <SalesRFQLineForm key={lineId} initialValues={initialValues} />
      <OpportunityLineNotes
        id={line.id}
        table="salesRfqLine"
        title={t`Notes`}
        subTitle={line.customerPartId ?? ""}
        internalNotes={line.internalNotes as JSONContent}
        externalNotes={line.externalNotes as JSONContent}
      />

      <DeferredFiles resolve={files}>
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
      </DeferredFiles>
      <CadModel
        isReadOnly={isReadOnly || !permissions.can("update", "sales")}
        metadata={{
          salesRfqLineId: line.id ?? undefined,
          itemId: line.itemId ?? undefined
        }}
        modelPath={line?.modelPath ?? null}
        title={t`CAD Model`}
        uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
        viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
      />

      <Outlet />
    </Fragment>
  );
}
