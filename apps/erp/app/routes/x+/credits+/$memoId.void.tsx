import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
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
    const result = await serviceRole.functions.invoke("post-memo", {
      body: {
        type: "void",
        memoId,
        userId,
        companyId
      }
    });
    if (result.error) {
      throw redirect(
        path.to.memo(memoId),
        await flash(request, error(result.error, "Failed to void memo"))
      );
    }
  } catch (err) {
    throw redirect(
      path.to.memo(memoId),
      await flash(request, error(err, "Failed to void memo"))
    );
  }

  throw redirect(
    path.to.memo(memoId),
    await flash(request, success("Memo voided"))
  );
}
