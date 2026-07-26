import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { dispositionInspection } from "@carbon/database/quality";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { createQualityIssue } from "~/services/quality.server";
import {
  getInspection,
  getInspectionMeasurements,
  getInspectionSamplingPlans
} from "~/services/quality.service";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { id } = params;
  if (!id) throw new Error("id is required");

  const formData = await request.formData();
  const operationId = (formData.get("operationId") as string | null)?.trim();
  const selectedIssueTypeId =
    (formData.get("nonConformanceTypeId") as string | null)?.trim() ||
    undefined;
  // Issue creation is optional — the operator can reject the lot without
  // opening one (default is to open one, matching the ERP flow).
  const createNcr =
    ((formData.get("createNcr") as string | null) ?? "true") !== "false";
  const returnTo = operationId
    ? path.to.inspection(operationId)
    : (requestReferrer(request) ?? path.to.operations);

  // 1. Cascade reject — flip the lot's status to Failed. Job Operation lots
  //    act on WIP: no tracked entities are flipped and no inventory write-off
  //    is returned (both are Receipt-source behaviors inside the engine), so
  //    there is no post-nonconformance invoke here.
  const dispositionResult = await dispositionInspection(getDatabaseClient(), {
    id,
    decision: "Reject",
    companyId,
    dispositionedBy: userId
  });
  if (dispositionResult.error) {
    throw redirect(
      returnTo,
      await flash(
        request,
        error(dispositionResult.error, "Failed to reject lot")
      )
    );
  }

  if (!createNcr) {
    throw redirect(returnTo, await flash(request, success("Lot rejected")));
  }

  // 2. Auto-create a quality issue through the MES's own job-operation-aware
  //    path so MRB can formally disposition the rejected WIP.
  const serviceRole = await getCarbonServiceRole();

  const inspection = await getInspection(serviceRole, id);
  if (inspection.error || !inspection.data) {
    throw redirect(
      returnTo,
      await flash(
        request,
        error(
          inspection.error,
          "Lot rejected, but failed to load it for the quality issue"
        )
      )
    );
  }
  const insp = inspection.data as any;
  const jobOperationId = insp.sourceDocumentLineId as string | null;
  if (!jobOperationId) {
    throw redirect(
      returnTo,
      await flash(
        request,
        error(null, "Lot rejected, but it has no job operation to link")
      )
    );
  }

  const inspectionReadableId = insp.inspectionId ?? "";
  const itemReadableId =
    insp.item?.readableId ?? insp.itemReadableId ?? insp.itemId;

  const issueTitle = [
    "Rejected lot",
    inspectionReadableId,
    itemReadableId && `— ${itemReadableId}`,
    insp.sourceDocumentReadableId && `on ${insp.sourceDocumentReadableId}`
  ]
    .filter(Boolean)
    .join(" ");

  // Document-driven lots: attach the failed characteristics (measured values
  // vs. spec) so MRB sees what failed and by how much without re-measuring.
  const [lotFeatures, lotMeasurements] = await Promise.all([
    getInspectionSamplingPlans(serviceRole, id, companyId),
    getInspectionMeasurements(serviceRole, id, companyId)
  ]);
  const failedFeatureLines: string[] = [];
  for (const lotFeature of lotFeatures.data ?? []) {
    const feature = lotFeature.inspectionFeature;
    if (!feature) continue;
    const featureMeasurements = (lotMeasurements.data ?? []).filter(
      (m) => m.inspectionFeatureId === feature.id
    );
    const recorded = featureMeasurements.filter(
      (m) => m.status !== "Pending"
    ).length;
    const failed = featureMeasurements.filter((m) => m.status === "Failed");
    if (failed.length === 0) continue;
    const failedValues = failed
      .map((m) => (m.value == null ? "F" : String(m.value)))
      .join(", ");
    const spec = [
      feature.nominalValue,
      feature.tolerancePlus != null || feature.toleranceMinus != null
        ? `+${feature.tolerancePlus ?? "0"}/−${feature.toleranceMinus ?? "0"}`
        : null,
      feature.unit
    ]
      .filter(Boolean)
      .join(" ");
    failedFeatureLines.push(
      spec
        ? `- ${feature.label}: nominal ${spec} — failed values: ${failedValues} (${failed.length}/${recorded} failed, n=${lotFeature.sampleSize}, Ac=${lotFeature.acceptanceNumber})`
        : `- ${feature.label}: ${failed.length}/${recorded} failed (n=${lotFeature.sampleSize}, Ac=${lotFeature.acceptanceNumber})`
    );
  }
  const failedFeaturesBlock =
    failedFeatureLines.length > 0
      ? `\n\nFailed characteristics:\n${failedFeatureLines.join("\n")}`
      : "";

  const issue = await createQualityIssue(serviceRole, {
    companyId,
    userId,
    jobOperationId,
    nonConformanceTypeId: selectedIssueTypeId,
    name: issueTitle,
    description: `Auto-created from inspection ${inspectionReadableId}. Lot size ${insp.lotSize}, sample ${insp.sampleSize}, Ac ${insp.acceptanceNumber} / Re ${insp.rejectionNumber}.${failedFeaturesBlock}`,
    priority: "Medium",
    quantity: Number(insp.lotSize ?? 1)
  });

  if (issue.error || !issue.data) {
    throw redirect(
      returnTo,
      await flash(
        request,
        error(
          issue.error,
          issue.message ?? "Lot rejected, but failed to create quality issue"
        )
      )
    );
  }

  // Link the source inspection to the issue so the ERP issue explorer can
  // surface the origin and deep-link back to the inspection lot.
  await serviceRole.from("nonConformanceInspection").insert({
    nonConformanceId: issue.data.id,
    inspectionId: id,
    companyId,
    createdBy: userId
  });

  throw redirect(
    returnTo,
    await flash(request, success("Lot rejected — quality issue created"))
  );
}
