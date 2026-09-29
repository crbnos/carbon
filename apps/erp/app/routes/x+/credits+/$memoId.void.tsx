import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ServerFnContext } from "@carbon/server-functions";
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
  try {
    const result = await postMemo(
      ServerFnContext.system({ db: getDatabaseClient(), companyId, userId }),
      { type: "void", memoId }
    );
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
