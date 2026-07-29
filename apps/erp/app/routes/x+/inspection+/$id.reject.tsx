import { assertIsPost, ERP_URL, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { notifyIssueCreated } from "@carbon/ee/notifications";
import { getLogger } from "@carbon/logger";
import { getLocalTimeZone, today } from "@internationalized/date";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import invariant from "tiny-invariant";
import {
  deleteIssue,
  getInspection,
  getInspectionMeasurements,
  getInspectionSamplingPlans,
  getIssueTypesList,
  insertIssue
} from "~/modules/quality";
import { dispositionInspection } from "~/modules/quality/quality.server";
import { getCompanyIntegrations } from "~/modules/settings/settings.server";
import { getUserDefaults } from "~/modules/users/users.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "inspections-id-reject");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

  const formData = await request.formData();
  const selectedIssueTypeId =
    (formData.get("nonConformanceTypeId") as string | null)?.trim() || null;
  // NCR creation is optional — the inspector can reject the lot without opening
  // one (default is to open one, preserving prior behavior).
  const createNcr =
    ((formData.get("createNcr") as string | null) ?? "true") !== "false";

  // 1. Cascade reject — mark every tracked entity in the lot as Rejected
  //    and flip the lot's status to Failed (ISO 9001:2015 §8.7).
  const dispositionResult = await dispositionInspection({
    id,
    decision: "Reject",
    companyId,
    dispositionedBy: userId,
    // ERP reject does receipt-specific NCR/write-off work — Receipt lots only.
    // Job Operation lots are rejected (with scrap/rework) by the MES route.
    requireSource: "Receipt"
  });
  if (dispositionResult.error) {
    throw redirect(
      path.to.inspection(id),
      await flash(
        request,
        error(dispositionResult.error, "Failed to reject lot")
      )
    );
  }

  // Post the inventory write-off (itemLedger + cost relief + GL) for a
  // non-tracked Inventory lot through the post-nonconformance edge function.
  // Idempotent per (documentType, documentId), so retrying the reject after a
  // failure here re-posts safely (the lot stays Rejected). A failed write-off
  // MUST abort before NCR creation: the NCR's disposition (closeIssue) restores
  // value on Use-As-Is/Rework on the assumption this write-off already removed
  // it, so proceeding would leave the received quantity double-counted on hand.
  const writeOff = dispositionResult.data?.writeOff;
  if (writeOff) {
    const post = await client.functions.invoke("post-nonconformance", {
      body: {
        companyId,
        userId,
        documentType: "Inbound Inspection",
        documentId: id,
        description: "Inbound inspection lot rejected",
        movements: [
          {
            itemId: writeOff.itemId,
            locationId: writeOff.locationId,
            trackedEntityId: null,
            quantity: writeOff.quantity
          }
        ]
      },
      region: FunctionRegion.UsEast1
    });
    if (post.error) {
      logger.error("Failed to post inspection reject write-off", {
        error: post.error,
        inspectionId: id
      });
      throw redirect(
        path.to.inspection(id),
        await flash(
          request,
          error(
            post.error,
            "Lot rejected, but the inventory write-off failed to post — resolve the accounting error and reject again to retry."
          )
        )
      );
    }
  }

  // If the inspector opted out of an NCR, we're done — the lot is rejected.
  if (!createNcr) {
    throw redirect(
      path.to.inspection(id),
      await flash(request, success("Lot rejected"))
    );
  }

  // 2. Auto-create an NCR and navigate the user straight to it so MRB can
  //    formally disposition (scrap / rework / return / use-as-is).
  const serviceRole = await getCarbonServiceRole();

  const [inspection, userDefaults, issueTypes] = await Promise.all([
    getInspection(client, id),
    getUserDefaults(client, userId, companyId),
    getIssueTypesList(client, companyId)
  ]);

  if (inspection.error || !inspection.data) {
    throw redirect(
      path.to.inspection(id),
      await flash(
        request,
        error(inspection.error, "Lot rejected, but failed to load it for NCR")
      )
    );
  }
  const insp = inspection.data as any;

  const issueType =
    issueTypes.data?.find((t) => t.id === selectedIssueTypeId) ??
    issueTypes.data?.[0];
  const locationId = userDefaults.data?.locationId ?? null;

  if (!issueType || !locationId) {
    throw redirect(
      path.to.inspection(id),
      await flash(
        request,
        error(
          null,
          "Lot rejected. Configure at least one Issue Type and a default user location to auto-create an NCR."
        )
      )
    );
  }

  const supplierName = insp.supplier?.name ?? "supplier";
  const sourceReadableId = insp.sourceDocumentReadableId ?? "";
  const itemReadableId =
    insp.item?.readableId ?? insp.itemReadableId ?? insp.itemId;
  const inspectionReadableId = insp.inspectionId ?? "";

  const issueTitle = [
    "Rejected lot",
    inspectionReadableId,
    itemReadableId && `— ${itemReadableId}`,
    sourceReadableId && `on ${sourceReadableId}`
  ]
    .filter(Boolean)
    .join(" ");

  // Document-driven lots: attach the failed features (measured values
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
      ? `\n\nFailed features:\n${failedFeatureLines.join("\n")}`
      : "";

  const createResult = await insertIssue(serviceRole, {
    name: issueTitle,
    description: `Auto-created from inbound inspection ${inspectionReadableId}. Lot size ${insp.lotSize}, sample ${insp.sampleSize}, Ac ${insp.acceptanceNumber} / Re ${insp.rejectionNumber}. Supplier: ${supplierName}.${failedFeaturesBlock}`,
    priority: "Medium",
    source: "Internal",
    locationId,
    nonConformanceTypeId: issueType.id,
    openDate: today(getLocalTimeZone()).toString(),
    quantity: Number(insp.lotSize ?? 0),
    items: insp.itemId ? [insp.itemId] : [],
    companyId,
    createdBy: userId
  });

  if (createResult.error || !createResult.data) {
    throw redirect(
      path.to.inspection(id),
      await flash(
        request,
        error(createResult.error, "Lot rejected, but failed to create NCR")
      )
    );
  }

  const ncrId = createResult.data.id;

  // insertIssue inserted nonConformanceItem rows with default qty 0 and
  // disposition 'Pending'. Now that we know the lot context, overwrite with
  // the actual lot quantity and default the MRB's starting disposition to
  // 'Scrap' (the most conservative outcome — they can downgrade to Rework /
  // Use As Is / split later).
  let scrapRowId: string | null = null;
  if (insp.itemId) {
    await serviceRole
      .from("nonConformanceItem")
      .update({
        quantity: Number(insp.lotSize ?? 0),
        disposition: "Scrap",
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("nonConformanceId", ncrId)
      .eq("itemId", insp.itemId);

    const scrapRow = await serviceRole
      .from("nonConformanceItem")
      .select("id")
      .eq("nonConformanceId", ncrId)
      .eq("itemId", insp.itemId)
      .single();
    scrapRowId = scrapRow.data?.id ?? null;
  }

  // Link the source inspection to the NCR so the issue explorer can surface
  // the origin and deep-link back to the inspection lot.
  await serviceRole.from("nonConformanceInspection").insert({
    nonConformanceId: ncrId,
    inspectionId: insp.id,
    companyId,
    createdBy: userId
  });

  // Also link the receipt line — gives the explorer the supplier / receipt
  // context through the existing "Receipt Lines" association branch.
  if (
    insp.sourceDocument === "Receipt" &&
    insp.sourceDocumentLineId &&
    insp.sourceDocumentId
  ) {
    await serviceRole.from("nonConformanceReceiptLine").insert({
      nonConformanceId: ncrId,
      receiptLineId: insp.sourceDocumentLineId,
      receiptId: insp.sourceDocumentId,
      receiptReadableId: insp.sourceDocumentReadableId ?? null,
      companyId,
      createdBy: userId
    });
  }

  // Link every tracked entity in the lot to the NCR.
  const trackedEntityIds = ((insp.inspectionSample as any[]) ?? [])
    .map((s) => s.trackedEntityId as string)
    .filter(Boolean);
  // Include un-sampled entities too (they were also Rejected by the cascade).
  const receiptLineEntities = await client
    .from("trackedEntity")
    .select("id")
    .eq("attributes ->> Receipt Line", insp.sourceDocumentLineId ?? "")
    .eq("companyId", companyId);
  const allLotEntityIds = Array.from(
    new Set([
      ...trackedEntityIds,
      ...(receiptLineEntities.data ?? []).map((r: any) => r.id as string)
    ])
  );

  if (allLotEntityIds.length > 0) {
    await serviceRole.from("nonConformanceTrackedEntity").insert(
      allLotEntityIds.map((trackedEntityId) => ({
        nonConformanceId: ncrId,
        trackedEntityId,
        companyId,
        createdBy: userId
      }))
    );

    // Seed the per-row entity links on the default Scrap row so the MRB can
    // split / reassign specific entities to other dispositions. Each entity
    // contributes its own quantity to the row.
    if (scrapRowId) {
      const entityQuantities = await serviceRole
        .from("trackedEntity")
        .select("id, quantity")
        .in("id", allLotEntityIds)
        .eq("companyId", companyId);
      const rows = (entityQuantities.data ?? []).map((e: any) => ({
        nonConformanceItemId: scrapRowId!,
        trackedEntityId: e.id as string,
        quantity: Number(e.quantity ?? 1),
        companyId,
        createdBy: userId
      }));
      if (rows.length > 0) {
        await (serviceRole as any)
          .from("nonConformanceItemTrackedEntity")
          .insert(rows);
      }
    }
  }

  const tasks = await serviceRole.functions.invoke("create", {
    body: {
      type: "nonConformanceTasks",
      id: ncrId,
      companyId,
      userId
    },
    region: FunctionRegion.UsEast1
  });
  if (tasks.error) {
    await deleteIssue(serviceRole, ncrId);
    throw redirect(
      path.to.inspection(id),
      await flash(
        request,
        error(tasks.error, "Lot rejected, but failed to create NCR tasks")
      )
    );
  }

  try {
    const integrations = await getCompanyIntegrations(client, companyId);
    await notifyIssueCreated({ client, serviceRole }, integrations, {
      companyId,
      userId,
      carbonUrl: `${ERP_URL}${path.to.issue(ncrId)}`,
      issue: {
        id: ncrId,
        nonConformanceId: createResult.data.nonConformanceId,
        title: issueTitle,
        description: `Auto-created from inbound inspection ${inspectionReadableId || id}`,
        severity: "Medium"
      }
    });
  } catch (err) {
    logger.error("Failed to send NCR notifications", { error: err });
  }

  throw redirect(
    path.to.issue(ncrId),
    await flash(request, success("Lot rejected — NCR opened"))
  );
}
