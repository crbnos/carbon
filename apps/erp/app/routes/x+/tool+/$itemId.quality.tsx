import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useParams } from "react-router";
import invariant from "tiny-invariant";
import { itemSamplingPlanValidator } from "~/modules/quality";
import {
  getItemSamplingPlan,
  upsertItemSamplingPlan
} from "~/modules/quality/quality.service.server";
import SamplingPlanForm from "~/modules/quality/ui/SamplingPlan/SamplingPlanForm";
import { getCompanySettings } from "~/modules/settings/settings.service.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts"
  });
  const { itemId } = params;
  invariant(itemId, "itemId is required");

  const [plan, settings] = await Promise.all([
    getItemSamplingPlan(itemId),
    getCompanySettings()
  ]);

  return data({
    plan: plan.data,
    samplingStandard:
      ((settings.data as any)?.samplingStandard as
        | "ANSI_Z1_4"
        | "ISO_2859_1") ?? "ANSI_Z1_4"
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { itemId } = params;
  invariant(itemId, "itemId is required");

  const formData = await request.formData();
  const validation = await validator(itemSamplingPlanValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const result = await upsertItemSamplingPlan({
    ...validation.data,
    companyId,
    updatedBy: userId
  });
  if (result.error) {
    throw redirect(
      path.to.toolQuality(itemId),
      await flash(request, error(result.error, "Failed to save sampling plan"))
    );
  }

  throw redirect(
    path.to.toolQuality(itemId),
    await flash(request, success("Sampling plan updated"))
  );
}

export default function ToolQualityRoute() {
  const { plan, samplingStandard } = useLoaderData<typeof loader>();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId is required");
  return (
    <div className="p-4">
      <SamplingPlanForm
        action={path.to.toolQuality(itemId)}
        itemId={itemId}
        standard={samplingStandard}
        initial={plan ?? undefined}
      />
    </div>
  );
}
