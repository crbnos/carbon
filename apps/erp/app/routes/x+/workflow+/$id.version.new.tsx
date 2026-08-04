import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { requirePlan } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { CURRENT_DEFINITION_FORMAT_VERSION } from "@carbon/workflows";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  getWorkflowVersion,
  getWorkflowVersions,
  insertWorkflowVersion,
  workflowVersionValidator
} from "~/modules/workflows";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "workflows"
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
  const validation = await validator(workflowVersionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const source = await getWorkflowVersion(
    client,
    validation.data.copyFromVersionId,
    companyId
  );

  if (source.error || !source.data) {
    return data(
      { success: false },
      await flash(request, error(source.error, "Could not read that version"))
    );
  }

  const existing = await getWorkflowVersions(client, id, companyId);
  const highest = existing.data?.[0]?.versionNumber ?? 0;

  const created = await insertWorkflowVersion(client, {
    workflowId: id,
    companyId,
    versionNumber: highest + 1,
    nodes: source.data.nodes as Json,
    edges: source.data.edges as Json,
    formatVersion: CURRENT_DEFINITION_FORMAT_VERSION,
    createdBy: userId
  });

  if (created.error || !created.data) {
    return data(
      { success: false },
      await flash(request, error(created.error, "Failed to create a version"))
    );
  }

  throw redirect(
    `${path.to.workflow(id)}?version=${created.data.id}`,
    await flash(
      request,
      success(`Created version ${created.data.versionNumber}`)
    )
  );
}
