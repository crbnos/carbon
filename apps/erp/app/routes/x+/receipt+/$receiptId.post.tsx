import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const { receiptId } = params;
  if (!receiptId) throw new Error("receiptId not found");

  const setPendingState = await client
    .from("receipt")
    .update({
      status: "Pending",
    })
    .eq("id", receiptId);

  if (setPendingState.error) {
    throw redirect(
      path.to.receipts,
      await flash(
        request,
        error(setPendingState.error, "Failed to post receipt")
      )
    );
  }

  try {
    const serviceRole = await getCarbonServiceRole();
    const postReceipt = await serviceRole.functions.invoke("post-receipt", {
      body: {
        receiptId: receiptId,
        userId: userId,
        companyId: companyId,
      },
    });

    if (postReceipt.error) {
      await client
        .from("receipt")
        .update({
          status: "Draft",
        })
        .eq("id", receiptId);

      throw redirect(
        path.to.receipts,
        await flash(request, error(postReceipt.error, "Failed to post receipt"))
      );
    }
  } catch (error) {
    await client
      .from("receipt")
      .update({
        status: "Draft",
      })
      .eq("id", receiptId);
  }

  throw redirect(path.to.receipts);
}
