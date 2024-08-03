import { json, type ActionFunctionArgs } from "@remix-run/node";
import {
  quoteLineAdditionalChargesValidator,
  upsertQuoteLineAdditionalCharges,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { assertIsPost } from "~/utils/http";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { client, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const { lineId } = params;
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();

  const additionalCharges = JSON.parse(
    (formData.get("additionalCharges") ?? "{}") as string
  );
  if (!additionalCharges)
    return json(
      {
        data: null,
        errors: { additionalCharges: "Additional charges are required" },
      },
      { status: 400 }
    );

  const parsedCharges =
    quoteLineAdditionalChargesValidator.safeParse(additionalCharges);
  if (parsedCharges.success === false) {
    return json(
      { data: null, errors: parsedCharges.error.errors?.[0].message },
      { status: 400 }
    );
  }

  const { error } = await upsertQuoteLineAdditionalCharges(client, lineId, {
    additionalCharges: parsedCharges.data,
    updatedBy: userId,
  });

  if (error) {
    return json(
      { data: null, errors: { form: error.message } },
      { status: 400 }
    );
  }

  return json({ data: parsedCharges, error: null });
}
