import { error, getCarbonServiceRole, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import { upsertQuoteLineMethod } from "~/modules/sales/sales.service";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production",
    role: "employee",
  });
  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const configuration = await request.json();
  if (configuration) {
    const [result, quoteLine] = await Promise.all([
      client
        .from("quoteLine")
        .update({
          configuration,
          updatedAt: new Date().toISOString(),
          updatedBy: userId,
        })
        .eq("id", lineId),
      client.from("quoteLine").select("itemId").eq("id", lineId).single(),
      client.from("quoteLinePrice").delete().eq("quoteLineId", lineId),
    ]);

    if (result.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.quoteLine(quoteId, lineId),
        await flash(request, error("Failed to update quote line"))
      );
    }

    if (quoteLine.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.quoteLine(quoteId, lineId),
        await flash(request, error("Failed to get quote line"))
      );
    }

    const serviceRole = await getCarbonServiceRole();
    const upsertMethod = await upsertQuoteLineMethod(serviceRole, {
      quoteId,
      quoteLineId: lineId,
      itemId: quoteLine.data.itemId,
      configuration,
      companyId,
      userId,
    });

    if (upsertMethod.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.quoteLine(quoteId, lineId),
        await flash(request, error("Failed to update quote line method"))
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
