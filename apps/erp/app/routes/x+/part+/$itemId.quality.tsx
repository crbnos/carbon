import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useParams } from "react-router";
import invariant from "tiny-invariant";
import { getInspectionDocumentsForItem } from "~/modules/production";
import {
  getItemInspectionDocumentAssignments,
  getItemSamplingPlan,
  itemInspectionDocumentAssignmentValidator,
  itemSamplingPlanValidator,
  upsertItemInspectionDocumentAssignment,
  upsertItemSamplingPlan
} from "~/modules/quality";
import type { ItemInspectionDocumentAssignment } from "~/modules/quality/types";
import ItemQualityView from "~/modules/quality/ui/SamplingPlan/ItemQualityView";
import { getCompanySettings } from "~/modules/settings";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });
  const { itemId } = params;
  invariant(itemId, "itemId is required");

  const [plan, settings, documents, assignments] = await Promise.all([
    getItemSamplingPlan(client, itemId, companyId),
    getCompanySettings(client, companyId),
    getInspectionDocumentsForItem(client, itemId, companyId),
    getItemInspectionDocumentAssignments(client, itemId, companyId)
  ]);

  return data({
    plan: plan.data,
    documents: documents.data ?? [],
    assignments: (assignments.data ?? []) as ItemInspectionDocumentAssignment[],
    samplingStandard:
      ((settings.data as any)?.samplingStandard as
        | "ANSI_Z1_4"
        | "ISO_2859_1") ?? "ANSI_Z1_4"
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { itemId } = params;
  invariant(itemId, "itemId is required");

  const formData = await request.formData();

  if (formData.get("intent") === "assignment") {
    const validation = await validator(
      itemInspectionDocumentAssignmentValidator
    ).validate(formData);
    if (validation.error) return validationError(validation.error);

    const result = await upsertItemInspectionDocumentAssignment(client, {
      ...validation.data,
      companyId,
      userId
    });
    if (result.error) {
      throw redirect(
        path.to.partQuality(itemId),
        await flash(request, error(result.error, "Failed to save assignment"))
      );
    }

    throw redirect(
      path.to.partQuality(itemId),
      await flash(request, success("Inspection document assignment updated"))
    );
  }

  const validation = await validator(itemSamplingPlanValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const result = await upsertItemSamplingPlan(client, {
    ...validation.data,
    companyId,
    updatedBy: userId
  });
  if (result.error) {
    throw redirect(
      path.to.partQuality(itemId),
      await flash(request, error(result.error, "Failed to save sampling plan"))
    );
  }

  throw redirect(
    path.to.partQuality(itemId),
    await flash(request, success("Sampling plan updated"))
  );
}

export default function PartQualityRoute() {
  const { plan, documents, assignments, samplingStandard } =
    useLoaderData<typeof loader>();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId is required");
  return (
    <ItemQualityView
      itemId={itemId}
      actionPath={path.to.partQuality(itemId)}
      standard={samplingStandard}
      plan={plan ?? undefined}
      documents={documents}
      assignments={assignments}
    />
  );
}
