import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import {
  updateWorkflowNodePositions,
  workflowNodePositionsValidator
} from "~/modules/workflows";
import { path } from "~/utils/path";

const positionsSchema = z.record(
  z.string(),
  z.object({ x: z.number(), y: z.number() })
);

// Node positions carry no behaviour, so the live-version lock deliberately does not
// apply here — a published workflow may still be tidied. The service writes positions
// only, and only onto node ids that already exist, so this route cannot change what a
// workflow does even when called by hand. `/save` stays locked.
export async function action({ params, request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { id } = params;
  if (!id) throw new Error("Could not find id");
  const { client, companyId } = await requirePermissions(request, {
    update: "workflows"
  });
  await requirePlan({
    request,
    client,
    companyId,
    feature: "WORKFLOWS",
    redirectTo: path.to.workflows
  });

  const validation = await validator(workflowNodePositionsValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(validation.data.positions);
  } catch {
    return data({ ok: false, error: "Malformed positions" }, { status: 400 });
  }

  const positions = positionsSchema.safeParse(parsed);
  if (!positions.success) {
    return data({ ok: false, error: "Malformed positions" }, { status: 400 });
  }

  const update = await updateWorkflowNodePositions(client, {
    versionId: validation.data.versionId,
    workflowId: id,
    companyId,
    positions: positions.data
  });

  if (update.error) {
    return data({ ok: false, error: update.error.message }, { status: 500 });
  }

  return data({ ok: true });
}
