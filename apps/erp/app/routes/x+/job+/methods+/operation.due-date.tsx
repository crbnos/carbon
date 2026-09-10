import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  notifyScheduleInputsChanged,
  updateJobOperationDueDate
} from "~/modules/production";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const id = formData.get("id") as string;
  const dueDate = formData.get("dueDate") as string | null;

  const update = await updateJobOperationDueDate(
    client,
    id,
    dueDate || null,
    userId
  );
  if (update.error) {
    return data(
      {},
      await flash(request, error(update.error, "Failed to update due date"))
    );
  }

  // A pin is a need-by override that must propagate upstream through the
  // backward pass — trigger the regen wave rather than waiting for the next
  // unrelated input change.
  await notifyScheduleInputsChanged(
    companyId,
    "reorder",
    "Operation due date pinned"
  );

  return {};
}
