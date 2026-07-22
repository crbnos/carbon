import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import invariant from "tiny-invariant";
import { getInspectionDocument } from "~/modules/production";
import {
  getInboundInspection,
  getInboundInspectionFeatures,
  getInboundInspectionLotTrackedEntities,
  getInboundInspectionMeasurements,
  getIssueTypesList
} from "~/modules/quality";
import { reconcileInboundInspectionFeatures } from "~/modules/quality/quality.server";
import type {
  InboundInspectionFeature,
  InboundInspectionMeasurement,
  InboundInspectionRow,
  InboundInspectionSample,
  InspectionTrackedEntity,
  IssueTypeListItem
} from "~/modules/quality/types";
import { getCompanySettings } from "~/modules/settings";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

  const [inspection, settings, issueTypes] = await Promise.all([
    getInboundInspection(client, id),
    getCompanySettings(client, companyId),
    getIssueTypesList(client, companyId)
  ]);

  if (inspection.error || !inspection.data) {
    throw redirect(
      path.to.inboundInspections,
      await flash(request, error(inspection.error, "Failed to load inspection"))
    );
  }

  const insp = inspection.data as InboundInspectionRow & {
    item: {
      readableId: string | null;
      name: string;
      type: string;
      itemTrackingType: string | null;
    } | null;
    receipt: {
      receiptId: string;
      supplierId: string | null;
      createdBy: string;
    } | null;
    supplier: { name: string } | null;
    inboundInspectionSample: InboundInspectionSample[];
  };

  if (insp.companyId !== companyId) {
    throw redirect(path.to.inboundInspections);
  }

  // The lot references its inspection document live — resolve per-lot plan
  // rows for any features added to the document after receipt.
  if (insp.inspectionDocumentId) {
    await reconcileInboundInspectionFeatures(id, companyId);
  }

  const [features, measurements, lotEntities, document] = await Promise.all([
    getInboundInspectionFeatures(client, id, companyId),
    getInboundInspectionMeasurements(client, id, companyId),
    getInboundInspectionLotTrackedEntities(
      client,
      insp.receiptLineId,
      companyId
    ),
    insp.inspectionDocumentId
      ? getInspectionDocument(getCarbonServiceRole(), insp.inspectionDocumentId)
      : Promise.resolve({ data: null, error: null })
  ]);

  return data({
    inspection: insp,
    receiptReadableId: insp.receipt?.receiptId ?? null,
    receiverId: insp.receipt?.createdBy ?? null,
    itemName: insp.item?.name ?? "",
    itemTrackingType: insp.item?.itemTrackingType ?? null,
    supplierName: insp.supplier?.name ?? null,
    samples: insp.inboundInspectionSample ?? [],
    features: (features.data ?? []) as InboundInspectionFeature[],
    measurements: (measurements.data ?? []) as InboundInspectionMeasurement[],
    document: document.data,
    lotEntities: (lotEntities.data ?? []) as InspectionTrackedEntity[],
    issueTypes: (issueTypes.data ?? []) as IssueTypeListItem[],
    enforceFourEyes:
      ((settings.data as any)?.enforceInspectionFourEyes as boolean) ?? false,
    currentUserId: userId
  });
}

export default function InboundInspectionExecutionRoute() {
  const loaderData = useLoaderData<typeof loader>();

  // Placeholder shell — replaced by InboundInspectionView (Task 11 of the
  // implementation plan).
  return (
    <div className="p-4">
      {loaderData.inspection.inboundInspectionId} — {loaderData.itemName}
    </div>
  );
}
