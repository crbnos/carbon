import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { postMemo } from "@carbon/server-functions/post-memo";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });
  const { memoId } = params;
  if (!memoId) {
    return { success: false, message: "Missing memoId" };
  }

  const serviceRole = getCarbonServiceRole();
  try {
    const result = await postMemo.withClient(serviceRole, getDatabaseClient(), {
      type: "post",
      memoId,
      userId,
      companyId
    });
    if (result.error) {
      const message = result.error.message || "Failed to post memo";
      throw redirect(
        path.to.memo(memoId),
        await flash(request, error(result.error, message))
      );
    }
  } catch (err) {
    throw redirect(
      path.to.memo(memoId),
      await flash(request, error(err, "Failed to post memo"))
    );
  }

  throw redirect(
    path.to.memo(memoId),
    await flash(request, success("Memo posted"))
  );
}
