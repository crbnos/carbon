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
  const { paymentId } = params;
  if (!paymentId) {
    return { success: false, message: "Missing paymentId" };
  }

  const serviceRole = getCarbonServiceRole();

  // Approval gate. Base amount = totalAmount * exchangeRate (the convention
  // post-payment itself uses). If a matching enabled rule exists and the payment
  // isn't already parked, park it in "Pending Approval" and request approval
  // instead of posting; the edge function only posts an approved Pending Approval.
  const payment = await serviceRole
    .from("payment")
    .select("status, totalAmount, exchangeRate")
    .eq("id", paymentId)
    .eq("companyId", companyId)
    .single();
  if (payment.data && payment.data.status === "Draft") {
    const baseAmount =
      Number(payment.data.totalAmount) * Number(payment.data.exchangeRate);
    if (
      await isApprovalRequired(serviceRole, "payment", companyId, baseAmount)
    ) {
      if (!(await hasPendingApproval(serviceRole, "payment", paymentId))) {
        const parked = await serviceRole
          .from("payment")
          .update({ status: "Pending Approval", updatedBy: userId })
          .eq("id", paymentId)
          .eq("companyId", companyId)
          .eq("status", "Draft");
        if (parked.error) {
          throw redirect(
            path.to.payment(paymentId),
            await flash(
              request,
              error(parked.error, "Failed to submit payment")
            )
          );
        }
        await createApprovalRequestAndNotify(serviceRole, {
          documentType: "payment",
          documentId: paymentId,
          companyId,
          requestedBy: userId,
          amount: baseAmount
        });
      }
      throw redirect(
        path.to.payment(paymentId),
        await flash(request, success("Payment submitted for approval"))
      );
    }
  }

  try {
    const result = await serviceRole.functions.invoke("post-payment", {
      body: {
        type: "post",
        paymentId,
        userId,
        companyId
      }
    });
    if (result.error) {
      const message =
        (result.data as { message?: string } | undefined)?.message ??
        result.error.message ??
        "Failed to post payment";
      throw redirect(
        path.to.payment(paymentId),
        await flash(request, error(result.error, message))
      );
    }
  } catch (err) {
    throw redirect(
      path.to.payment(paymentId),
      await flash(request, error(err, "Failed to post payment"))
    );
  }

  throw redirect(
    path.to.payment(paymentId),
    await flash(request, success("Payment posted"))
  );
}
