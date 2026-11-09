// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  getRecentInspectionGauges,
  reconcileInspectionSamplingPlans
} from "@carbon/database/quality";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { ManualInspectionView } from "~/components/Inspection/ManualInspectionView";
import { getDatabaseClient } from "~/services/database.server";
import {
  getInspection,
  getInspectionDocumentWithBalloons,
  getInspectionGauges,
  getInspectionMeasurements,
  getInspectionSamplingPlans,
  getManualInspectionTrackedEntities
} from "~/services/quality.service";
import type {
  InspectionSample,
  InspectionTrackedEntity
} from "~/services/types";
import type { Handle } from "~/utils/handle";
import { recordMeta } from "~/utils/meta";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: [
    { table: "inspection", column: "id", param: "id" },
    { table: "inspectionSample", column: "inspectionId", param: "id" }
  ]
};

const logger = getLogger("mes", "manual-inspection");

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  recordMeta(
    [data?.inspection?.inspectionId, data?.inspection?.itemReadableId],
    "Inspection"
  );

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw new Error("Inspection ID is required");

  // Every read below uses the service role (operators may not hold
  // quality_view), so prove the lot belongs to this company first.
  const serviceRole = getCarbonServiceRole();
  const scoped = await serviceRole
    .from("inspection")
    .select("id, sourceDocument, sourceDocumentLineId")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (scoped.error || !scoped.data) {
    logger.warn("Inspection not found for company", {
      companyId,
      inspectionId: id,
      error: scoped.error
    });
    throw redirect(
      path.to.inspections,
      await flash(request, error(scoped.error, "Failed to fetch inspection"))
    );
  }

  // Only manual lots execute here: a job-operation lot has its own view, and
  // a receipt lot is dispositioned in the ERP.
  if (scoped.data.sourceDocument !== "Manual") {
    if (
      scoped.data.sourceDocument === "Job Operation" &&
      scoped.data.sourceDocumentLineId
    ) {
      throw redirect(path.to.inspection(scoped.data.sourceDocumentLineId));
    }
    throw redirect(path.to.inspections);
  }

  const inspectionResult = await getInspection(serviceRole, id);
  if (inspectionResult.error || !inspectionResult.data) {
    throw redirect(
      path.to.inspections,
      await flash(
        request,
        error(inspectionResult.error, "Failed to fetch inspection")
      )
    );
  }
  const inspection = inspectionResult.data as any;

  // The lot references its document live: features added to the document
  // after the lot was made get their per-lot plan rows resolved lazily.
  if (inspection.inspectionDocumentId) {
    await reconcileInspectionSamplingPlans(getDatabaseClient(), id, companyId);
  }

  const [
    features,
    measurements,
    lotEntities,
    document,
    gauges,
    recentGauges,
    workCenter
  ] = await Promise.all([
    getInspectionSamplingPlans(serviceRole, id, companyId),
    getInspectionMeasurements(serviceRole, id, companyId),
    getManualInspectionTrackedEntities(serviceRole, id, companyId),
    inspection.inspectionDocumentId
      ? getInspectionDocumentWithBalloons(
          serviceRole,
          inspection.inspectionDocumentId
        )
      : Promise.resolve(null),
    getInspectionGauges(serviceRole, companyId, id),
    getRecentInspectionGauges(getDatabaseClient(), {
      inspectionId: id,
      companyId
    }),
    inspection.workCenterId
      ? serviceRole
          .from("workCenter")
          .select("name")
          .eq("id", inspection.workCenterId)
          .eq("companyId", companyId)
          .maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  // Sample column order must match the engine's required-feature derivation
  // (createdAt asc, id asc).
  const samples = (
    [...(inspection.inspectionSample ?? [])] as InspectionSample[]
  ).sort(
    (a, b) =>
      (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
      a.id.localeCompare(b.id)
  );

  return {
    inspection,
    samples,
    features: features.data ?? [],
    measurements: measurements.data ?? [],
    gauges: gauges.data ?? [],
    recentGaugeIds: recentGauges.data ?? [],
    lotEntities: (lotEntities.data ?? [])
      .map((row) => row.trackedEntity)
      .filter((entity): entity is InspectionTrackedEntity => Boolean(entity)),
    workCenterName: workCenter.data?.name ?? null,
    balloons: document?.data?.balloons ?? [],
    documentName: document?.data?.name ?? null,
    parameters: document?.data?.parameters ?? [],
    pdfUrl: document?.data?.pdfUrl ?? null,
    model: document?.data?.model ?? null
  };
}

export default function ManualInspectionRoute() {
  const data = useLoaderData<typeof loader>();
  return <ManualInspectionView {...data} />;
}
