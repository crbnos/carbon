import { json } from "@remix-run/react";

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { updateJobBatchNumber } from "~/modules/production/production.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "production",
    bypassRls: true,
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");
  const formData = await request.formData();
  const trackedEntityId = String(formData.get("id"));
  const value = String(formData.get("value"));
  if (!value) throw new Error("Could not find value");

  // we need a service role here
  const update = await updateJobBatchNumber(client, trackedEntityId, value);

  if (update.error) {
    return json(
      update,
      await flash(request, error(update.error, update.error.message))
    );
  }

  return json(update);
}
