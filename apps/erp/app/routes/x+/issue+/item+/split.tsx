import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { isIssueLocked, splitIssueItemValidator } from "~/modules/quality";
import { splitIssueItem } from "~/modules/quality/quality-disposition.server";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const formData = await request.formData();
  const validation = await validator(splitIssueItemValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const { id, entityAssignments, splitQuantity } = validation.data;

  const existing = await client
    .from("nonConformanceItem")
    .select("nonConformance(status)")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();

  if (existing.error || !existing.data) {
    return data(
      { error: { message: "Item association not found" } },
      await flash(request, error(existing.error, "Item association not found"))
    );
  }

  const lockedError = requireUnlockedBulk({
    statuses: [(existing.data as any).nonConformance?.status ?? null],
    checkFn: isIssueLocked,
    message: "Cannot modify a closed issue. Reopen it first."
  });
  if (lockedError) return lockedError;

  const result = await splitIssueItem({
    id,
    companyId,
    userId,
    splitQuantity,
    entityAssignments: entityAssignments ?? undefined
  });

  if (result.error) {
    return data(
      { error: result.error },
      await flash(request, error(result.error, result.error.message))
    );
  }

  return data({ success: true }, await flash(request, success("Line split")));
}
