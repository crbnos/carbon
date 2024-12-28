import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    update: "production",
    role: "employee",
  });
  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const configuration = await request.json();
  if (configuration) {
    const result = await client
      .from("quoteLine")
      .update({
        configuration,
        updatedAt: new Date().toISOString(),
        updatedBy: userId,
      })
      .eq("id", lineId);

    if (result.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.quoteLine(quoteId, lineId),
        await flash(request, error("Failed to update quote line"))
      );
    }
  } else {
    throw new Error("No configuration provided");
  }
  throw redirect(
    requestReferrer(request) ?? path.to.quoteLine(quoteId, lineId),
    await flash(request, success("Updated quote line"))
  );
}
