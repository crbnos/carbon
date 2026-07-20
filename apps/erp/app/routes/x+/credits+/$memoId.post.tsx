import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  createApprovalRequestAndNotify,
  hasPendingApproval,
  isApprovalRequired
} from "~/modules/shared";
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

  // Approval gate. Base amount = amount * exchangeRate. Park a Draft memo in
  // "Pending Approval" and request approval when a matching enabled rule exists.
  const memo = await serviceRole
    .from("memo")
    .select("status, amount, exchangeRate")
    .eq("id", memoId)
    .eq("companyId", companyId)
    .single();
  if (memo.data && memo.data.status === "Draft") {
    const baseAmount =
      Number(memo.data.amount) * Number(memo.data.exchangeRate);
    if (await isApprovalRequired(serviceRole, "memo", companyId, baseAmount)) {
      if (!(await hasPendingApproval(serviceRole, "memo", memoId))) {
        const parked = await serviceRole
          .from("memo")
          .update({ status: "Pending Approval", updatedBy: userId })
          .eq("id", memoId)
          .eq("companyId", companyId)
          .eq("status", "Draft");
        if (parked.error) {
          throw redirect(
            path.to.memo(memoId),
            await flash(request, error(parked.error, "Failed to submit memo"))
          );
        }
        await createApprovalRequestAndNotify(serviceRole, {
          documentType: "memo",
          documentId: memoId,
          companyId,
          requestedBy: userId,
          amount: baseAmount
        });
      }
      throw redirect(
        path.to.memo(memoId),
        await flash(request, success("Memo submitted for approval"))
      );
    }
  }

  try {
    const result = await serviceRole.functions.invoke("post-memo", {
      body: {
        type: "post",
        memoId,
        userId,
        companyId
      }
    });
    if (result.error) {
      const message =
        (result.data as { message?: string } | undefined)?.message ??
        result.error.message ??
        "Failed to post memo";
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
