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
      quoteLineId: z.string(),
      key: z.enum(["unitPrice", "leadTime", "discountPercent", "shippingCost"]),
      value: zfd.numeric(z.number()),
    }),
    z.object({
      hasPrice: z.literal("false"),
      quantity: zfd.numeric(z.number()),
      quoteLineId: z.string(),
      price: z.string(),
    }),
  ])
);

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    update: "sales",
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();

  const validation = await validator(priceUpdateValidator).validate(formData);

  if (validation.error) {
    return json({ error: "Invalid form data" }, { status: 400 });
  }

  const { hasPrice, quantity, quoteLineId } = validation.data;
  if (hasPrice === "true") {
    const { key, value } = validation.data;
    const update = await client
      .from("quoteLinePrice")
      .update({
        [key]: value,
        quoteLineId,
        quantity,
      })
      .eq("quoteLineId", quoteLineId)
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
      const insert = await client.from("quoteLinePrice").insert({
        ...parsedPrice,
        quoteLineId,
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
