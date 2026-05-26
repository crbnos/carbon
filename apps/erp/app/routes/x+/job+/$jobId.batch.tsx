import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { updateJobBatchNumber } from "~/modules/production/production.service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    update: "production",
    bypassRls: true
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");
  const formData = await request.formData();
  const trackedEntityId = String(formData.get("id"));
  const rawValue = formData.get("value");
  const value = rawValue == null ? "" : String(rawValue).trim();

  const update = await updateJobBatchNumber(
    trackedEntityId,
    value === "" ? null : value
  );

  if (update.error) {
    return data(
      update,
      await flash(request, error(update.error, update.error.message))
    );
  }

  return update;
}
