import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assignIssueItemEntitiesValidator,
  isIssueLocked
} from "~/modules/quality";
import { assignEntitiesToIssueItem } from "~/modules/quality/quality-disposition.server";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const formData = await request.formData();
  const validation = await validator(assignIssueItemEntitiesValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const { nonConformanceItemId, targetItemId, entityAssignments } =
    validation.data;

  const parent = await client
    .from("nonConformanceItem")
    .select("nonConformance(status)")
    .eq("id", nonConformanceItemId)
    .eq("companyId", companyId)
    .single();
  const lockedError = requireUnlockedBulk({
    statuses: [(parent.data as any)?.nonConformance?.status ?? null],
    checkFn: isIssueLocked,
    message: "Cannot modify a closed issue. Reopen it first."
  });
  if (lockedError) return lockedError;

  const result = await assignEntitiesToIssueItem({
    nonConformanceItemId,
    targetItemId,
    assignments: entityAssignments,
    companyId,
    userId
  });

  if (result.error) {
    return data(
      { error: result.error },
      await flash(request, error(result.error, "Failed to move entities"))
    );
  }

  return data(
    { success: true },
    await flash(request, success("Moved entities"))
  );
}
