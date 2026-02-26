import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getSupplierPriceBreaksForItems } from "~/modules/items";
import {
  quoteLineValidator,
  upsertQuoteLine,
  upsertQuoteLineMethod,
  upsertQuoteLinePrices
} from "~/modules/sales";
import { lookupBuyPriceFromMap } from "~/modules/shared";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const formData = await request.formData();
  const validation = await validator(quoteLineValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;
  let configuration = undefined;
  if (d.configuration) {
    try {
      configuration = JSON.parse(d.configuration);
    } catch (error) {
      console.error(error);
    }
  }

  const serviceRole = getCarbonServiceRole();
  const createQuotationLine = await upsertQuoteLine(serviceRole, {
    ...d,
    companyId,
    configuration,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  console.log(createQuotationLine);

  if (createQuotationLine.error) {
    console.log(createQuotationLine);
    throw redirect(
      path.to.quote(quoteId),
      await flash(
        request,
        error(createQuotationLine.error, "Failed to create quote line.")
      )
    );
  }

  const quoteLineId = createQuotationLine.data.id;

  if (d.methodType === "Buy") {
    const quantities = d.quantity ?? [1];
    const priceMap = await getSupplierPriceBreaksForItems(serviceRole, [
      d.itemId
    ]);
    await upsertQuoteLinePrices(
      serviceRole,
      quoteId,
      quoteLineId,
      quantities.map((qty) => ({
        quoteLineId,
        quantity: qty,
        unitPrice: lookupBuyPriceFromMap(d.itemId, qty, priceMap, 0),
        leadTime: 0,
        discountPercent: 0,
        createdBy: userId
      }))
    );
  }

  if (d.methodType === "Make") {
    const upsertMethod = await upsertQuoteLineMethod(serviceRole, {
      quoteId,
      quoteLineId,
      itemId: d.itemId,
      configuration,
      companyId,
      userId
    });

    if (upsertMethod.error) {
      throw redirect(
        path.to.quoteLine(quoteId, quoteLineId),
        await flash(
          request,
          error(upsertMethod.error, "Failed to create quote line method.")
        )
      );
    }

    // Fix BOM material costs: replace average cost with price break values
    const buyMaterials = await serviceRole
      .from("quoteMaterial")
      .select("id, itemId, unitCost")
      .eq("quoteLineId", quoteLineId)
      .eq("methodType", "Buy");

    const buyItemIds = [
      ...new Set((buyMaterials.data ?? []).map((m) => m.itemId))
    ];
    const bomPriceMap = await getSupplierPriceBreaksForItems(
      serviceRole,
      buyItemIds
    );

    for (const mat of buyMaterials.data ?? []) {
      const price = lookupBuyPriceFromMap(
        mat.itemId,
        1,
        bomPriceMap,
        mat.unitCost
      );
      if (price !== mat.unitCost) {
        await serviceRole
          .from("quoteMaterial")
          .update({ unitCost: price })
          .eq("id", mat.id);
      }
    }
  }

  throw redirect(path.to.quoteLine(quoteId, quoteLineId));
}
