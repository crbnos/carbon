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
  const { id } = params;
  if (!id) {
    return { success: false, message: "Missing charge id" };
  }

  const serviceRole = getCarbonServiceRole();
  try {
    const result = await serviceRole.functions.invoke("post-charge", {
      body: {
        type: "void",
        chargeId: id,
        userId,
        companyId
      }
    });
    if (result.error) {
      // The edge function's own refusal ("Charge is already voided", "Cannot
      // void a Draft charge") is the only useful thing to say here; the generic
      // string is the last resort. Mirrors `reimbursements+/$reimbursementId.pay`.
      const message =
        (result.data as { message?: string } | undefined)?.message ??
        result.error.message ??
        "Failed to void charge";
      throw redirect(
        path.to.charge(id),
        await flash(request, error(result.error, message))
      );
    }
  } catch (err) {
    // A redirect is control flow, not a failure — including the one thrown just
    // above carrying the edge function's own message ("Charge is already
    // voided"). Swallowing it replaced that with a generic string and handed a
    // `Response` object to `error()` as the thing to log.
    if (err instanceof Response) throw err;
    throw redirect(
      path.to.charge(id),
      await flash(request, error(err, "Failed to void charge"))
    );
  }

  throw redirect(
    path.to.charge(id),
    await flash(request, success("Charge voided"))
  );
}
