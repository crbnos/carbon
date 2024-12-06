import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { updateQuoteLinePrecision } from "~/modules/sales";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { client } = await requirePermissions(request, {
    update: "sales",
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();

  const precision = Number(formData.get("precision") ?? 2);

  const updatePrecision = await updateQuoteLinePrecision(
    client,
    lineId,
    precision
  );
  if (updatePrecision.error) {
    return json(
      { data: null, error: updatePrecision.error.message },
      { status: 400 }
    );
  }

  return json({ data: null, error: null });
}
