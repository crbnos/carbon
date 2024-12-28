import { json, type ActionFunctionArgs } from "@vercel/remix";

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JobOperation } from "~/modules/production";
import { updateJobOperationStatus } from "~/modules/production";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "production",
  });

  const formData = await request.formData();
  const id = formData.get("id") as string;
  const status = formData.get("status") as JobOperation["status"];

  const update = await updateJobOperationStatus(client, id, status, userId);
  if (update.error) {
    return json(
      {},
      await flash(request, error(update.error, "Failed to update status"))
    );
  }

  return json({});
}
