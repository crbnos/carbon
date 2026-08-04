import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { workflowPublishValidator } from "~/modules/workflows";
import { publishWorkflowVersion } from "~/modules/workflows/workflows.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "workflows"
  });
  await requirePlan({
    request,
    client,
    companyId,
    feature: "WORKFLOWS",
    redirectTo: path.to.workflows
  });

  const { id } = params;
  if (!id) throw new Error("id is not found");

  const formData = await request.formData();
  const validation = await validator(workflowPublishValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const published = await publishWorkflowVersion(client, {
    workflowId: id,
    versionId: validation.data.versionId,
    companyId,
    userId
  });

  // A non-empty issue list means nothing was written.
  if (!published.ok) {
    return data(
      { ok: false as const, issues: published.issues },
      published.message
        ? await flash(request, error(null, published.message))
        : undefined
    );
  }

  return data(
    { ok: true as const, issues: [] },
    await flash(request, success("Published"))
  );
}
