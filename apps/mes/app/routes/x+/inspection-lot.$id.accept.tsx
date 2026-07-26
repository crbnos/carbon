import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { dispositionInspection } from "@carbon/database/quality";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { id } = params;
  if (!id) throw new Error("id is required");

  const formData = await request.formData();
  const operationId = (formData.get("operationId") as string | null)?.trim();
  const returnTo = operationId
    ? path.to.inspection(operationId)
    : (requestReferrer(request) ?? path.to.operations);

  const result = await dispositionInspection(getDatabaseClient(), {
    id,
    decision: "Accept",
    companyId,
    dispositionedBy: userId
  });

  if (result.error) {
    throw redirect(
      returnTo,
      await flash(request, error(result.error, "Failed to accept lot"))
    );
  }

  throw redirect(returnTo, await flash(request, success("Lot accepted")));
}
