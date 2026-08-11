import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { requirePlan } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { CURRENT_DEFINITION_FORMAT_VERSION } from "@carbon/workflows";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  insertWorkflow,
  insertWorkflowVersion,
  workflowValidator
} from "~/modules/workflows";
import {
  createNode,
  TRIGGER_POSITION
} from "~/modules/workflows/ui/Builder/graph";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
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

  const formData = await request.formData();
  const validation = await validator(workflowValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { name, description } = validation.data;

  const created = await insertWorkflow(client, {
    name,
    description,
    companyId,
    createdBy: userId
  });

  if (created.error || !created.data) {
    return data(
      { success: false },
      await flash(request, error(created.error, "Failed to create workflow"))
    );
  }

  // Seed version 1 with one trigger node so the canvas is never empty.
  const trigger = createNode("trigger", TRIGGER_POSITION);

  const version = await insertWorkflowVersion(client, {
    workflowId: created.data.id,
    companyId,
    versionNumber: 1,
    nodes: [trigger] as unknown as Json,
    edges: [] as unknown as Json,
    formatVersion: CURRENT_DEFINITION_FORMAT_VERSION,
    createdBy: userId
  });

  if (version.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(version.error, "Failed to create the first workflow version")
      )
    );
  }

  return data({ id: created.data.id }, { status: 201 });
}
