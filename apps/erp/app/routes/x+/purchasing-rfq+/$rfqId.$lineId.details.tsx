import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Fragment } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useParams } from "react-router";
import { CadModel, DeferredFiles } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { PurchasingRFQ } from "~/modules/purchasing";
import {
  getPurchasingRFQ,
  getPurchasingRFQLine,
  getSupplierInteractionLineDocuments,
  isRfqLocked,
  purchasingRfqLineValidator,
  upsertPurchasingRFQLine
} from "~/modules/purchasing";
import { PurchasingRFQLineForm } from "~/modules/purchasing/ui/PurchasingRfq";
import {
  SupplierInteractionLineDocuments,
  SupplierInteractionLineNotes
} from "~/modules/purchasing/ui/SupplierInteraction";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { rfqId, lineId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");
  if (!lineId) throw new Error("Could not find lineId");

  const serviceRole = getCarbonServiceRole();

  const line = await getPurchasingRFQLine(serviceRole, lineId);

  if (line.error) {
    throw redirect(
      path.to.purchasingRfq(rfqId),
      await flash(request, error(line.error, "Failed to load line"))
    );
  }

  return {
    line: line.data,
    files: getSupplierInteractionLineDocuments(serviceRole, companyId, lineId)
  };
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client: viewClient } = await requirePermissions(request, {
    view: "purchasing"
  });
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { rfqId, lineId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");
  if (!lineId) throw new Error("Could not find lineId");

  const rfq = await getPurchasingRFQ(viewClient, rfqId);
  await requireUnlocked({
    request,
    isLocked: isRfqLocked(rfq.data?.status),
    redirectTo: path.to.purchasingRfq(rfqId),
    message: "Cannot modify a locked RFQ. Reopen it first."
  });

  const formData = await request.formData();

  const validation = await validator(purchasingRfqLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const updateLine = await upsertPurchasingRFQLine(client, {
    id: lineId,
    ...d,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateLine.error) {
    throw redirect(
      path.to.purchasingRfqLine(rfqId, lineId),
      await flash(request, error(updateLine.error, "Failed to update RFQ line"))
    );
  }

  throw redirect(path.to.purchasingRfqLine(rfqId, lineId));
}

export default function PurchasingRFQLine() {
  const { line, files } = useLoaderData<typeof loader>();

  const permissions = usePermissions();

  const { rfqId, lineId } = useParams();
  if (!rfqId) throw new Error("Could not find rfqId");
  if (!lineId) throw new Error("Could not find lineId");

  const rfqData = useRouteData<{
    rfqSummary: PurchasingRFQ;
  }>(path.to.purchasingRfq(rfqId));

  const isReadOnly = isRfqLocked(rfqData?.rfqSummary?.status);

  const initialValues = {
    ...line,
    id: line.id ?? undefined,
    purchasingRfqId: line.purchasingRfqId ?? "",
    description: line.description ?? "",
    itemId: line.itemId ?? "",
    quantity: line.quantity ?? [1],
    order: line.order ?? 1,
    purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode ?? "",
    inventoryUnitOfMeasureCode: line.inventoryUnitOfMeasureCode ?? "",
    conversionFactor: line.conversionFactor ?? 1,
    itemType: (line.itemType ?? "Part") as
      | "Part"
      | "Material"
      | "Tool"
      | "Consumable"
  };

  return (
    <Fragment key={lineId}>
      <PurchasingRFQLineForm key={lineId} initialValues={initialValues} />
      <SupplierInteractionLineNotes
        id={line.id}
        table="purchasingRfqLine"
        title="Notes"
        subTitle={line.itemReadableId ?? ""}
        internalNotes={line.internalNotes as JSONContent}
        externalNotes={line.externalNotes as JSONContent}
      />
      <DeferredFiles resolve={files}>
        {(resolvedFiles) => (
          <SupplierInteractionLineDocuments
            files={resolvedFiles ?? []}
            id={rfqId}
            lineId={lineId}
            type="Purchasing Request for Quote"
          />
        )}
      </DeferredFiles>
      <CadModel
        isReadOnly={isReadOnly || !permissions.can("update", "purchasing")}
        metadata={{
          purchasingRfqLineId: line.id ?? undefined,
          itemId: line.itemId ?? undefined
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
