// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  getRecentInspectionGauges,
  prefillInspectionSamples,
  reconcileInspectionSamplingPlans
} from "@carbon/database/quality";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { ManualInspectionView } from "~/components/Inspection/ManualInspectionView";
import type { InspectionLot } from "~/components/Inspection/useInspectionLotState";
import { getDatabaseClient } from "~/services/database.server";
import {
  getInspection,
  getInspectionDocumentWithBalloons,
  getInspectionGauges,
  getInspectionMeasurements,
  getInspectionSamplingPlans,
  getManualInspectionTrackedEntities,
  getReceiptInspectionTrackedEntities
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

type LoadedInspection = InspectionLot & {
  inspectionSample: InspectionSample[] | null;
};

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  recordMeta(
    [data?.inspection?.inspectionId, data?.inspection?.itemReadableId],
    "Inspection"
  );

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw new Error("Inspection ID is required");

  // Every read below uses the service role (operators may not hold
  // quality_view), so prove the lot belongs to this company first.
  const serviceRole = getCarbonServiceRole();
  const scoped = await serviceRole
    .from("inspection")
    .select("id, sourceDocument, sourceDocumentId, sourceDocumentLineId")
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

  // Receipt and manual lots execute here (hold, then release or reject); a
  // job-operation lot has its own view around its operation.
  const isReceipt = scoped.data.sourceDocument === "Receipt";
  if (!isReceipt && scoped.data.sourceDocument !== "Manual") {
    if (
      scoped.data.sourceDocument === "Job Operation" &&
      scoped.data.sourceDocumentLineId
    ) {
      throw redirect(path.to.inspection(scoped.data.sourceDocumentLineId));
    }
    throw redirect(path.to.inspections);
  }

  // A serial receipt lot that inspects every unit has nothing to choose: each
  // unit is a sample from the start (idempotent). One sampling a subset is
  // left to the scanner. A manual lot made its samples at create.
  // A failure only means the units are scanned in instead: log it and go on.
  if (isReceipt) {
    const prefill = await prefillInspectionSamples(getDatabaseClient(), {
      inspectionId: id,
      companyId,
      userId
    });
    if (prefill.error) {
      logger.error("Failed to prefill inspection samples", {
        companyId,
        inspectionId: id,
        error: prefill.error
      });
    }
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
  // getInspection's embeds are untyped: this is the row it selects.
  const inspection = inspectionResult.data as LoadedInspection;

  // The lot references its document live: features added to the document
  // after the lot was made get their per-lot plan rows resolved lazily.
  // A failure leaves the new features without a column: log it and go on.
  if (inspection.inspectionDocumentId) {
    const reconciled = await reconcileInspectionSamplingPlans(
      getDatabaseClient(),
      id,
      companyId
    );
    if (reconciled.error) {
      logger.error("Failed to reconcile inspection sampling plans", {
        companyId,
        inspectionId: id,
        error: reconciled.error
      });
    }
  }

  const [
    features,
    measurements,
    lotEntities,
    document,
    gauges,
    recentGauges,
    workCenter,
    receipt
  ] = await Promise.all([
    getInspectionSamplingPlans(serviceRole, id, companyId),
    getInspectionMeasurements(serviceRole, id, companyId),
    // A receipt lot's units hang off its receipt line; a manual lot lists its own.
    isReceipt
      ? getReceiptInspectionTrackedEntities(
          serviceRole,
          scoped.data.sourceDocumentLineId ?? "",
          companyId
        )
      : getManualInspectionTrackedEntities(serviceRole, id, companyId),
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
      : Promise.resolve({ data: null }),
    // A voided receipt closes its lot: the stock it inspects was never received.
    isReceipt
      ? serviceRole
          .from("receipt")
          .select("status")
          .eq("id", scoped.data.sourceDocumentId)
          .eq("companyId", companyId)
          .maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  // Sample column order must match the engine's required-feature derivation
  // (createdAt asc, id asc).
  const samples = [...(inspection.inspectionSample ?? [])].sort(
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
    lotEntities: (lotEntities.data ?? []) as InspectionTrackedEntity[],
    receiptVoided: receipt.data?.status === "Voided",
    workCenterName: workCenter.data?.name ?? null,
    balloons: document?.data?.balloons ?? [],
    documentName: document?.data?.name ?? null,
    parameters: document?.data?.parameters ?? [],
    workInstruction: (document?.data?.workInstruction ??
      null) as JSONContent | null,
    pdfUrl: document?.data?.pdfUrl ?? null,
    model: document?.data?.model ?? null
  };
}

export default function ManualInspectionRoute() {
  const data = useLoaderData<typeof loader>();
  return <ManualInspectionView {...data} />;
}
