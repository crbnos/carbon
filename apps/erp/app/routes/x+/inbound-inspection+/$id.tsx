import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import invariant from "tiny-invariant";
import { getBalloons, getInspectionDocument } from "~/modules/production";
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
import InboundInspectionView from "~/modules/quality/ui/InboundInspections/InboundInspectionView";
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

  const serviceRole = getCarbonServiceRole();
  const [features, measurements, lotEntities, document, balloons] =
    await Promise.all([
      getInboundInspectionFeatures(client, id, companyId),
      getInboundInspectionMeasurements(client, id, companyId),
      getInboundInspectionLotTrackedEntities(
        client,
        insp.receiptLineId,
        companyId
      ),
      insp.inspectionDocumentId
        ? getInspectionDocument(serviceRole, insp.inspectionDocumentId)
        : Promise.resolve({ data: null, error: null }),
      insp.inspectionDocumentId
        ? getBalloons(serviceRole, insp.inspectionDocumentId)
        : Promise.resolve({ data: null, error: null })
    ]);

  const doc = document.data as {
    name?: string | null;
    content?: { pdfUrl?: string | null };
  } | null;

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
    balloons: ((balloons.data ?? []) as any[]).map((b) => ({
      id: b.id as string,
      inspectionFeatureId: b.inspectionFeatureId as string,
      pageNumber: Number(b.pageNumber ?? 1),
      xCoordinate: Number(b.xCoordinate ?? 0),
      yCoordinate: Number(b.yCoordinate ?? 0)
    })),
    documentName: doc?.name ?? null,
    pdfUrl: doc?.content?.pdfUrl ?? null,
    lotEntities: (lotEntities.data ?? []) as InspectionTrackedEntity[],
    issueTypes: (issueTypes.data ?? []) as IssueTypeListItem[],
    enforceFourEyes:
      ((settings.data as any)?.enforceInspectionFourEyes as boolean) ?? false,
    currentUserId: userId
  });
}

export default function InboundInspectionExecutionRoute() {
  const loaderData = useLoaderData<typeof loader>();

  return (
    <InboundInspectionView
      inspection={loaderData.inspection as InboundInspectionRow}
      receiptReadableId={loaderData.receiptReadableId}
      receiverId={loaderData.receiverId}
      itemName={loaderData.itemName}
      itemTrackingType={loaderData.itemTrackingType}
      supplierName={loaderData.supplierName}
      samples={loaderData.samples as InboundInspectionSample[]}
      features={loaderData.features as InboundInspectionFeature[]}
      measurements={loaderData.measurements as InboundInspectionMeasurement[]}
      balloons={loaderData.balloons}
      documentName={loaderData.documentName}
      pdfUrl={loaderData.pdfUrl}
      lotEntities={loaderData.lotEntities as InspectionTrackedEntity[]}
      issueTypes={loaderData.issueTypes as IssueTypeListItem[]}
      currentUserId={loaderData.currentUserId}
      enforceFourEyes={loaderData.enforceFourEyes}
    />
  );
}
