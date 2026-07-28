import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { duplicateJobOperationStep } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const duplicate = await duplicateJobOperationStep(client, {
    id,
    companyId,
    createdBy: userId
  });
  if (duplicate.error) {
    return data(
      { id: null },
      await flash(
        request,
        error(duplicate.error, "Failed to duplicate job operation step")
      )
    );
  }

  return { id: duplicate.data?.id ?? null };
}
