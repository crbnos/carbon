import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { getSupabaseServiceRole } from "~/lib/supabase";
import {
  jobOperationValidator,
  recalculateJobMakeMethodRequirements,
  upsertJobOperation,
} from "~/modules/production";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "production",
  });

  const serviceRole = getSupabaseServiceRole();
  const { jobId } = params;
  if (!jobId) {
    throw new Error("jobId not found");
  }

  const formData = await request.formData();
  const validation = await validator(jobOperationValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertJobOperation = await upsertJobOperation(serviceRole, {
    ...data,
    jobId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertJobOperation.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertJobOperation.error, "Failed to insert job operation")
      )
    );
  }

  const jobOperationId = insertJobOperation.data?.id;
  if (!jobOperationId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertJobOperation, "Failed to insert job operation")
      )
    );
  }

  const recalculateResult = await recalculateJobMakeMethodRequirements(
    serviceRole,
    {
      id: validation.data.jobMakeMethodId,
      companyId,
      userId,
    }
  );

  if (recalculateResult.error) {
    return json(
      { id: jobOperationId },
      await flash(
        request,
        error(
          recalculateResult.error,
          "Failed to recalculate job make method requirements"
        )
      )
    );
  }

  return json({ id: jobOperationId });
}
