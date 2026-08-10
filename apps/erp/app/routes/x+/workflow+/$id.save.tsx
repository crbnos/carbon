import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { Json } from "@carbon/database";
import { requirePlan } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import {
  CURRENT_DEFINITION_FORMAT_VERSION,
  workflowDefinitionSchema
} from "@carbon/workflows";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  updateWorkflowDefinition,
  workflowDefinitionSaveValidator
} from "~/modules/workflows";
import { checkWorkflowVersionLock } from "~/modules/workflows/workflows.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "workflow-save");

export async function action({ request }: ActionFunctionArgs) {
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

  const formData = await request.formData();
  const validation = await validator(workflowDefinitionSaveValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { versionId, nodes, edges } = validation.data;

  // The live-version lock is enforced here, not only in the UI — a direct POST
  // to a promoted version must write nothing.
  const lock = await checkWorkflowVersionLock(client, { versionId, companyId });
  if (!lock.ok) {
    return data({ ok: false, error: lock.message }, { status: 409 });
  }

  let parsed: unknown;
  try {
    parsed = {
      formatVersion: CURRENT_DEFINITION_FORMAT_VERSION,
      nodes: JSON.parse(nodes),
      edges: JSON.parse(edges)
    };
  } catch {
    return data({ ok: false, error: "Malformed definition" }, { status: 400 });
  }

  // A half-filled node parses fine — publishing is what rejects it. Reaching here
  // means the canvas sent something genuinely corrupt, so name the field.
  const definition = workflowDefinitionSchema.safeParse(parsed);
  if (!definition.success) {
    const first = definition.error.issues[0];
    const where = first?.path.join(".");
    // Paths and codes, never the definition itself: the payload is customer data
    // and this is a plain server log.
    logger.error("Invalid workflow definition on save", {
      versionId,
      issues: definition.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code
      }))
    });
    return data(
      {
        ok: false,
        error: first
          ? `Invalid definition${where ? ` at ${where}` : ""}: ${first.message}`
          : "Invalid definition"
      },
      { status: 400 }
    );
  }

  // Always write the constant — the SQL column default is a stale 1.
  const update = await updateWorkflowDefinition(client, {
    versionId,
    companyId,
    nodes: definition.data.nodes as unknown as Json,
    edges: definition.data.edges as unknown as Json,
    formatVersion: CURRENT_DEFINITION_FORMAT_VERSION,
    updatedBy: userId
  });

  if (update.error) {
    return data({ ok: false, error: update.error.message }, { status: 500 });
  }

  return data({ ok: true });
}
