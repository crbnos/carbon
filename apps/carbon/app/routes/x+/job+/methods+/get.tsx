import { getCarbonServiceRole } from "@carbon/auth";
import { validationError, validator } from "@carbon/form";
import { json, redirect, type ActionFunctionArgs } from "@vercel/remix";
import {
  getJobMethodValidator,
  recalculateJobRequirements,
  upsertJobMaterialMakeMethod,
  upsertJobMethod,
} from "~/modules/production";
import { requirePermissions } from "~/services/auth/auth.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "production",
  });

  const formData = await request.formData();
  const type = formData.get("type") as string;

  const serviceRole = getCarbonServiceRole();

  const validation = await validator(getJobMethodValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  if (["item", "quoteLine"].includes(type)) {
    const jobMethod = await upsertJobMethod(
      serviceRole,
      type === "item" ? "itemToJob" : "quoteLineToJob",
      {
        ...validation.data,
        companyId,
        userId,
      }
    );

    const calculateQuantities = await recalculateJobRequirements(serviceRole, {
      id: validation.data.targetId,
      companyId: companyId,
      userId: userId,
    });

    if (calculateQuantities.error) {
      return json({
        error: "Failed to calculate job quantities",
      });
    }

    return json({
      error: jobMethod.error ? "Failed to get job method" : null,
    });
  }

  if (type === "method") {
    const makeMethod = await upsertJobMaterialMakeMethod(serviceRole, {
      ...validation.data,
      companyId,
      userId,
    });

    if (makeMethod.error) {
      return json({
        error: makeMethod.error
          ? "Failed to insert job material make method"
          : null,
      });
    }

    throw redirect(requestReferrer(request) ?? path.to.jobs);
  }

  return json({ error: "Invalid type" }, { status: 400 });
}
