import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { postMemo } from "~/modules/invoicing/invoicing.server";
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

  // Shared with the invoicing_postMemo tool.
  const result = await postMemo({ memoId, companyId, userId });
  if (result.error) {
    throw redirect(
      path.to.memo(memoId),
      await flash(
        request,
        error(result.error.cause ?? null, result.error.flash)
      )
    );
  }

  throw redirect(
    path.to.memo(memoId),
    await flash(request, success("Memo posted"))
  );
}
