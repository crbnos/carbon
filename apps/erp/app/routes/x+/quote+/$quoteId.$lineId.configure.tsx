import { error, getCarbonServiceRole, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getSupplierPriceBreaksForItems } from "~/modules/items";
import { upsertQuoteLineMethod } from "~/modules/sales/sales.service";
import { lookupBuyPriceFromMap } from "~/modules/shared";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production",
    role: "employee"
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
          updatedBy: userId
        })
        .eq("id", lineId),
      client.from("quoteLine").select("itemId").eq("id", lineId).single(),
      client.from("quoteLinePrice").delete().eq("quoteLineId", lineId)
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
      userId
    });

    if (upsertMethod.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.quoteLine(quoteId, lineId),
        await flash(request, error("Failed to update quote line method"))
      );
    }

    // Fix BOM material costs: replace average cost with price break values
    const buyMaterials = await serviceRole
      .from("quoteMaterial")
      .select("id, itemId, unitCost")
      .eq("quoteLineId", lineId)
      .eq("methodType", "Buy");

    const buyItemIds = [
      ...new Set((buyMaterials.data ?? []).map((m) => m.itemId))
    ];
    const priceMap = await getSupplierPriceBreaksForItems(
      serviceRole,
      buyItemIds
    );

    for (const mat of buyMaterials.data ?? []) {
      const price = lookupBuyPriceFromMap(
        mat.itemId,
        1,
        priceMap,
        mat.unitCost
      );
      if (price !== mat.unitCost) {
        await serviceRole
          .from("quoteMaterial")
          .update({ unitCost: price })
          .eq("id", mat.id);
      }
    }
  } else {
    throw new Error("No configuration provided");
  }
  throw redirect(
    requestReferrer(request) ?? path.to.quoteLine(quoteId, lineId),
    await flash(request, success("Updated quote line"))
  );
}
