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
      throw redirect(
        path.to.charge(id),
        await flash(request, error(result.error, "Failed to void charge"))
      );
    }
  } catch (err) {
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
