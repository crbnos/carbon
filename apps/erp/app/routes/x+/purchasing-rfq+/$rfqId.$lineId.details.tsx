import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Spinner } from "@carbon/react";
import { Fragment, Suspense } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Await,
  Outlet,
  redirect,
  useLoaderData,
  useParams
} from "react-router";
import { CadModel } from "~/components";
import { usePermissions } from "~/hooks";
import {
  getPurchasingRFQLine,
  getSupplierInteractionLineDocuments,
  purchasingRfqLineValidator,
  upsertPurchasingRFQLine
} from "~/modules/purchasing";
import { PurchasingRFQLineForm } from "~/modules/purchasing/ui/PurchasingRfq";
import {
  SupplierInteractionLineDocuments,
  SupplierInteractionLineNotes
} from "~/modules/purchasing/ui/SupplierInteraction";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { rfqId, lineId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");
  if (!lineId) throw new Error("Could not find lineId");

  const serviceRole = await getCarbonServiceRole();

  const [line] = await Promise.all([getPurchasingRFQLine(serviceRole, lineId)]);

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
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { rfqId, lineId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");
  if (!lineId) throw new Error("Could not find lineId");

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
      <Suspense
        fallback={
          <div className="flex w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
            <Spinner className="h-10 w-10" />
          </div>
        }
      >
        <Await resolve={files}>
          {(resolvedFiles) => (
            <SupplierInteractionLineDocuments
              files={resolvedFiles ?? []}
              id={rfqId}
              lineId={lineId}
              type="Purchasing Request for Quote"
            />
          )}
        </Await>
      </Suspense>
      <CadModel
        isReadOnly={!permissions.can("update", "purchasing")}
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
