import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useParams } from "react-router";
import invariant from "tiny-invariant";
import {
  getItemSamplingPlan,
  itemSamplingPlanValidator,
  upsertItemSamplingPlan
} from "~/modules/quality";
import SamplingPlanForm from "~/modules/quality/ui/SamplingPlan/SamplingPlanForm";
import { getCompanySettings } from "~/modules/settings";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });
  const { itemId } = params;
  invariant(itemId, "itemId is required");

  const [plan, settings] = await Promise.all([
    getItemSamplingPlan(client, itemId, companyId),
    getCompanySettings(client, companyId)
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
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { itemId } = params;
  invariant(itemId, "itemId is required");

  const formData = await request.formData();
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
      path.to.serviceQuality(itemId),
      await flash(request, error(result.error, "Failed to save sampling plan"))
    );
  }

  throw redirect(
    path.to.serviceQuality(itemId),
    await flash(request, success("Sampling plan updated"))
  );
}

export default function ServiceQualityRoute() {
  const { plan, samplingStandard } = useLoaderData<typeof loader>();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId is required");
  return (
    <div className="p-4">
      <SamplingPlanForm
        action={path.to.serviceQuality(itemId)}
        itemId={itemId}
        standard={samplingStandard}
        initial={plan ?? undefined}
      />
    </div>
  );
}
