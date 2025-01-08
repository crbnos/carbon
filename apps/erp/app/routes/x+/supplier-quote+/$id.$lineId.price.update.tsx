import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { z } from "zod";
import { zfd } from "zod-form-data";

const priceUpdateValidator = z.object({}).and(
  z.discriminatedUnion("hasPrice", [
    z.object({
      hasPrice: z.literal("true"),
      quantity: zfd.numeric(z.number()),
      supplierQuoteLineId: z.string(),
      key: z.enum([
        "leadTime",
        "supplierUnitPrice",
        "supplierShippingCost",
        "supplierTaxAmount",
      ]),
      value: zfd.numeric(z.number()),
    }),
    z.object({
      hasPrice: z.literal("false"),
      quantity: zfd.numeric(z.number()),
      supplierQuoteLineId: z.string(),
      price: z.string(),
    }),
  ])
);

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    update: "purchasing",
  });

  const { id, lineId } = params;
  if (!id) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();

  const validation = await validator(priceUpdateValidator).validate(formData);

  if (validation.error) {
    console.error(validation.error);
    return json({ error: "Invalid form data" }, { status: 400 });
  }

  const { hasPrice, quantity, supplierQuoteLineId } = validation.data;
  if (hasPrice === "true") {
    const { key, value } = validation.data;
    const update = await client
      .from("supplierQuoteLinePrice")
      .update({
        [key]: value,
        supplierQuoteLineId,
        quantity,
      })
      .eq("supplierQuoteLineId", supplierQuoteLineId)
      .eq("quantity", quantity);

    if (update.error) {
      console.error(update.error);
      return json(
        { error: "Failed to update quote line price" },
        { status: 500 }
      );
    }
  } else {
    const { price } = validation.data;
    try {
      const parsedPrice = JSON.parse(price);
      const insert = await client.from("supplierQuoteLinePrice").insert({
        ...parsedPrice,
        supplierQuoteLineId,
        quantity,
      });

      if (insert.error) {
        console.error(insert.error);
        return json(
          { error: "Failed to update quote line price" },
          { status: 500 }
        );
      }
    } catch (error) {
      console.error(error);
      return json({ error: "Invalid price data format" }, { status: 400 });
    }
  }

  return json({});
}
