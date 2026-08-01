import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import invariant from "tiny-invariant";
import { getBalloons, getInspectionDocument } from "~/modules/production";
import {
  getInspection,
  getInspectionMeasurements,
  getInspectionSamplingPlans,
  getInspectionTrackedEntities,
  getIssueTypesList
} from "~/modules/quality";
import { reconcileInspectionSamplingPlans } from "~/modules/quality/quality.server";
import type {
  InspectionMeasurement,
  InspectionRow,
  InspectionSample,
  InspectionSamplingPlan,
  InspectionTrackedEntity,
  IssueTypeListItem
} from "~/modules/quality/types";
import InspectionView from "~/modules/quality/ui/Inspections/InspectionView";
import { getCompanySettings } from "~/modules/settings";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Inspections`, to: path.to.inspections },
    (data) => data?.inspection?.inspectionId
  )
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

  const [inspection, settings, issueTypes] = await Promise.all([
    getInspection(client, id),
    getCompanySettings(client, companyId),
    getIssueTypesList(client, companyId)
  ]);

  if (inspection.error || !inspection.data) {
    throw redirect(
      path.to.inspections,
      await flash(request, error(inspection.error, "Failed to load inspection"))
    );
  }

  const insp = inspection.data as InspectionRow & {
    item: {
      readableId: string | null;
      name: string;
      type: string;
      itemTrackingType: string | null;
    } | null;
    supplier: { name: string } | null;
    inspectionSample: InspectionSample[];
  };

  if (insp.companyId !== companyId) {
    throw redirect(path.to.inspections);
  }

  // The lot references its inspection document live — resolve per-lot plan
  // rows for any features added to the document after receipt.
  if (insp.inspectionDocumentId) {
    await reconcileInspectionSamplingPlans(id, companyId);
  }

  const isReceiptSource = insp.sourceDocument === "Receipt";
  const serviceRole = getCarbonServiceRole();
  const [features, measurements, lotEntities, document, balloons, receipt] =
    await Promise.all([
      getInspectionSamplingPlans(client, id, companyId),
      getInspectionMeasurements(client, id, companyId),
      isReceiptSource && insp.sourceDocumentLineId
        ? getInspectionTrackedEntities(
            client,
            insp.sourceDocumentLineId,
            companyId
          )
        : Promise.resolve({ data: null, error: null }),
      insp.inspectionDocumentId
        ? getInspectionDocument(
            serviceRole,
            insp.inspectionDocumentId,
            companyId
          )
        : Promise.resolve({ data: null, error: null }),
      insp.inspectionDocumentId
        ? getBalloons(serviceRole, insp.inspectionDocumentId)
        : Promise.resolve({ data: null, error: null }),
      // Four-eyes: the receiver is the receipt's creator (no FK on the generic
      // source id, so this is a separate lookup).
      isReceiptSource
        ? client
            .from("receipt")
            .select("createdBy")
            .eq("id", insp.sourceDocumentId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null })
    ]);

  const doc = document.data as {
    name?: string | null;
    content?: { pdfUrl?: string | null };
  } | null;

  return data({
    inspection: insp,
    sourceDocumentReadableId: insp.sourceDocumentReadableId ?? null,
    receiverId: receipt.data?.createdBy ?? null,
    itemName: insp.item?.name ?? "",
    itemTrackingType: insp.item?.itemTrackingType ?? null,
    supplierName: insp.supplier?.name ?? null,
    samples: insp.inspectionSample ?? [],
    features: (features.data ?? []) as InspectionSamplingPlan[],
    measurements: (measurements.data ?? []) as InspectionMeasurement[],
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

export default function InspectionExecutionRoute() {
  const loaderData = useLoaderData<typeof loader>();

  return (
    <InspectionView
      inspection={loaderData.inspection as InspectionRow}
      sourceDocumentReadableId={loaderData.sourceDocumentReadableId}
      receiverId={loaderData.receiverId}
      itemName={loaderData.itemName}
      itemTrackingType={loaderData.itemTrackingType}
      supplierName={loaderData.supplierName}
      samples={loaderData.samples as InspectionSample[]}
      features={loaderData.features as InspectionSamplingPlan[]}
      measurements={loaderData.measurements as InspectionMeasurement[]}
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
