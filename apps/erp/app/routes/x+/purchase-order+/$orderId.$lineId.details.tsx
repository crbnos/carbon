// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { type JSONContent, RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Fragment } from "react/jsx-runtime";
import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  useLoaderData,
  useParams
} from "react-router";
import { CadModel, DeferredFiles } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import {
  chargeNumberError,
  checkProjectBudget,
  getLineChargeNumber
} from "~/modules/projects/projects.service";
import {
  isPurchaseOrderEditLocked,
  purchaseOrderLineValidator
} from "~/modules/purchasing/purchasing.models";
import {
  getPurchaseOrderLine,
  getSupplierInteractionLineDocuments
} from "~/modules/purchasing/purchasing.service";
import { PurchaseOrderLineForm } from "~/modules/purchasing/ui/PurchaseOrder";
import {
  SupplierInteractionLineDocuments,
  SupplierInteractionLineNotes
} from "~/modules/purchasing/ui/SupplierInteraction";
import { getDatabaseClient } from "~/services/database.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

const logger = getLogger("erp", "purchase-order-line-details");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing",
    role: "employee",
    bypassRls: true
  });

  const { orderId, lineId } = params;
  if (!orderId) throw notFound("orderId not found");
  if (!lineId) throw notFound("lineId not found");

  const [line, chargeNumber] = await Promise.all([
    getPurchaseOrderLine(client, lineId),
    getLineChargeNumber(client, "purchaseOrderLine", lineId, companyId)
  ]);
  if (line.error) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(
        request,
        error(line.error, "Failed to load purchase order line")
      )
    );
  }

  // bypassRls hands back the service role and lineId comes from the URL: the
  // line must belong to this company and to the order in the URL.
  if (
    line.data.companyId !== companyId ||
    line.data.purchaseOrderId !== orderId
  ) {
    logger.error("Purchase order line not found for company", {
      companyId,
      orderId,
      lineId
    });
    throw notFound("Purchase order line not found");
  }

  return {
    line: line?.data ?? null,
    chargeNumber: chargeNumber.data ?? null,
    files: getSupplierInteractionLineDocuments(client, companyId, lineId)
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { orderId, lineId } = params;
  if (!orderId) throw new Error("Could not find orderId");
  if (!lineId) throw new Error("Could not find lineId");

  const { client, companyId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const formData = await request.formData();
  const validation = await validator(purchaseOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // Dates save on their own (the Dates section); sent empty here, the
  // update would clear them.
  const {
    id: _id,
    requiredDate: _requiredDate,
    promisedDate: _promisedDate,
    ...d
  } = validation.data;

  const chargeError = await chargeNumberError(client, companyId, d);
  if (chargeError) {
    return validationError({
      fieldErrors: { [chargeError.field]: chargeError.message }
    });
  }

  // Budget control (Government Contracting 5c, C2 and C4). The saved line's
  // own commitment is left out and replaced by its open quantity at the new
  // price, so an edit never counts twice. Block refuses the save; Warn saves
  // and flashes the overrun.
  const currentLine = d.projectId
    ? await getPurchaseOrderLine(client, lineId)
    : null;
  if (currentLine?.error) {
    throw redirect(
      path.to.purchaseOrderLine(orderId, lineId),
      await flash(
        request,
        error(currentLine.error, "Failed to load purchase order line")
      )
    );
  }
  const budget = d.projectId
    ? await checkProjectBudget(getDatabaseClient(), client, {
        companyId,
        source: "purchase",
        charges: [
          {
            projectId: d.projectId,
            projectElementId: d.projectElementId ?? null,
            amount:
              Math.max(
                0,
                (d.purchaseQuantity ?? 0) -
                  (currentLine?.data?.quantityReceived ?? 0)
              ) *
              ((d.supplierUnitPrice ?? 0) / (d.exchangeRate || 1)),
            excludePurchaseOrderLineIds: [lineId]
          }
        ]
      })
    : null;
  if (budget?.status === "block") {
    return validationError({
      fieldErrors: { purchaseQuantity: budget.message }
    });
  }

  // The operation refuses an order in approval or finished, keeps a released
  // order's lines above what was received, and sends an order whose total
  // goes above its approved amount back for approval.
  const api = await carbon(request);
  const result = await api.purchasing.updatePurchaseOrderLine({
    ...d,
    id: lineId,
    purchaseOrderId: orderId,
    customFields: setCustomFields(formData)
  });

  return respond(request, result).redirect(
    path.to.purchaseOrderLine(orderId, lineId),
    budget?.status === "warn"
      ? { message: `Line saved. ${budget.message}` }
      : undefined
  );
}

export default function EditPurchaseOrderLineRoute() {
  const { orderId, lineId } = useParams();
  if (!orderId) throw new Error("orderId not found");
  if (!lineId) throw new Error("lineId not found");

  const permissions = usePermissions();
  const routeData = useRouteData<{
    purchaseOrder: { status: string };
  }>(path.to.purchaseOrder(orderId));
  const isReadOnly = isPurchaseOrderEditLocked(
    routeData?.purchaseOrder?.status
  );

  const { line, chargeNumber, files } = useLoaderData<typeof loader>();

  const initialValues = {
    id: line?.id ?? undefined,
    purchaseOrderId: line?.purchaseOrderId ?? "",
    purchaseOrderLineType: (line?.purchaseOrderLineType ?? "Part") as "Part",
    itemId: line?.itemId ?? "",
    accountId: line?.accountId ?? "",
    assetId: line?.assetId ?? "",
    conversionFactor: line?.conversionFactor ?? 1,
    description: line?.description ?? "",
    exchangeRate: line?.exchangeRate ?? 1,
    inventoryUnitOfMeasureCode: line?.inventoryUnitOfMeasureCode ?? "",
    jobId: line?.jobId ?? "",
    jobOperationId: line?.jobOperationId ?? "",
    locationId: line?.locationId ?? "",
    purchaseQuantity: line?.purchaseQuantity ?? 1,
    purchaseUnitOfMeasureCode: line?.purchaseUnitOfMeasureCode ?? "",
    storageUnitId: line?.storageUnitId ?? "",
    supplierPartId: line?.supplierPartId ?? "",
    supplierShippingCost: line?.supplierShippingCost ?? 0,
    supplierTaxAmount: line?.supplierTaxAmount ?? 0,
    supplierUnitPrice: line?.supplierUnitPrice ?? 0,
    costCenterId: line?.costCenterId ?? "",
    projectId: chargeNumber?.projectId ?? "",
    projectElementId: chargeNumber?.projectElementId ?? "",
    taxPercent: line?.taxPercent ?? 0,
    assetReadableId: (line as any)?.assetReadableId ?? "",
    assetName: (line as any)?.assetName ?? "",
    ...getCustomFields(line?.customFields)
  };

  return (
    <Fragment key={lineId}>
      <PurchaseOrderLineForm
        key={initialValues.id}
        initialValues={initialValues}
        isReceived={
          Number(line.quantityReceived ?? 0) > 0 ||
          Number(line.quantityInvoiced ?? 0) > 0
        }
        lineDates={{
          receivedComplete: line.receivedComplete ?? false,
          requiredDate: line.requiredDate,
          promisedDate: line.promisedDate,
          receivedDate: line.receivedDate
        }}
      />
      <SupplierInteractionLineNotes
        id={line?.id ?? ""}
        table="purchaseOrderLine"
        title="Notes"
        subTitle={
          line.purchaseOrderLineType === "Fixed Asset"
            ? (line.assetName ?? line.description ?? "")
            : line.purchaseOrderLineType === "G/L Account"
              ? (line.description ?? "")
              : (line.itemReadableId ?? "")
        }
        internalNotes={line.internalNotes as JSONContent}
        externalNotes={line.externalNotes as JSONContent}
      />

      <DeferredFiles resolve={files}>
        {(resolvedFiles) => (
          <SupplierInteractionLineDocuments
            files={resolvedFiles ?? []}
            id={orderId}
            lineId={lineId}
            type="Purchase Order"
          />
        )}
      </DeferredFiles>
      <CadModel
        isReadOnly={isReadOnly || !permissions.can("update", "purchasing")}
        metadata={{
          itemId: line?.itemId ?? undefined
        }}
        modelUpload={line ?? null}
        title="CAD Model"
        uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
        viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
      />

      <RecordOutlet />
    </Fragment>
  );
}
