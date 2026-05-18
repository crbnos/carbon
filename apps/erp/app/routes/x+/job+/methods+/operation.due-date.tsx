import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { updateJobOperationDueDate } from "~/modules/production";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const id = formData.get("id") as string;
  const dueDate = formData.get("dueDate") as string | null;

  const update = await updateJobOperationDueDate(id, dueDate || null, userId);
  if (update.error) {
    return data(
      {},
      await flash(request, error(update.error, "Failed to update due date"))
    );
  }

  return {};
}
