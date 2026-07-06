import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  generatePickingList,
  generatePickingListValidator
} from "~/modules/inventory";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const formData = await request.formData();

  // Handle jobOperationIds as array from form data
  const jobOperationIds = formData.getAll("jobOperationIds[]").map(String);
  const locationId = formData.get("locationId") as string;
  const assignee = formData.get("assignee") as string | null;
  const dueDate = formData.get("dueDate") as string | null;

  const validation = generatePickingListValidator.safeParse({
    jobOperationIds,
    locationId,
    assignee: assignee || undefined,
    dueDate: dueDate || undefined
  });

  if (!validation.success) {
    throw redirect(
      path.to.pickingLists,
      await flash(
        request,
        error(null, validation.error.issues[0]?.message ?? "Invalid form data")
      )
    );
  }

  const result = await generatePickingList(client, {
    jobOperationIds: validation.data.jobOperationIds,
    locationId: validation.data.locationId,
    companyId,
    createdBy: userId,
    assignee: validation.data.assignee ?? null,
    dueDate: validation.data.dueDate ?? null
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.pickingLists,
      await flash(
        request,
        error(result.error, "Failed to generate picking list")
      )
    );
  }

  throw redirect(path.to.pickingListDetails(result.data.id));
}
