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
    return { success: false, message: "Missing card transaction id" };
  }

  const serviceRole = getCarbonServiceRole();
  try {
    const result = await serviceRole.functions.invoke("post-card-transaction", {
      body: {
        type: "void",
        cardTransactionId: id,
        userId,
        companyId
      }
    });
    if (result.error) {
      throw redirect(
        path.to.cardTransaction(id),
        await flash(
          request,
          error(result.error, "Failed to void card transaction")
        )
      );
    }
  } catch (err) {
    throw redirect(
      path.to.cardTransaction(id),
      await flash(request, error(err, "Failed to void card transaction"))
    );
  }

  throw redirect(
    path.to.cardTransaction(id),
    await flash(request, success("Card transaction voided"))
  );
}
