import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  cutListStatusValidator,
  getCutList,
  updateCutListStatus
} from "~/modules/production";

/**
 * Cut list lifecycle. Completion is not reachable here — it happens through
 * the confirmation route, which also posts inventory. Anything not in this map
 * is rejected rather than silently applied.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  Draft: ["Released", "Cancelled"],
  Released: ["In Progress", "Cancelled"],
  "In Progress": ["Cancelled"],
  Completed: [],
  Cancelled: []
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const formData = await request.formData();
  const validation = await validator(cutListStatusValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const current = await getCutList(client, id, companyId);
  if (current.error || !current.data) {
    return data(
      {},
      await flash(request, error(current.error, "Failed to load cut list"))
    );
  }

  const from = current.data.status ?? "Draft";
  const to = validation.data.status;

  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    return data(
      {},
      await flash(
        request,
        error({ from, to }, `A cut list cannot go from ${from} to ${to}`)
      )
    );
  }

  const updated = await updateCutListStatus(client, {
    id,
    companyId,
    status: to,
    updatedBy: userId
  });

  if (updated.error) {
    return data(
      {},
      await flash(request, error(updated.error, "Failed to update status"))
    );
  }

  return data(
    {},
    await flash(request, success(`Cut list ${to.toLowerCase()}`))
  );
}
