import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  quoteLineAdditionalChargesValidator,
  upsertQuoteLineAdditionalCharges
} from "~/modules/sales";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { client, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { lineId } = params;
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();
  const id = formData.get("id") as string;
  const additionalCharges = JSON.parse(
    (formData.get("additionalCharges") ?? "{}") as string
  );
  if (!additionalCharges)
    return data(
      {
        data: null,
        errors: { additionalCharges: "Additional charges are required" }
      },
      { status: 400 }
    );

  const parsedCharges =
    quoteLineAdditionalChargesValidator.safeParse(additionalCharges);
  if (parsedCharges.success === false) {
    return data(
      { data: null, errors: parsedCharges.error.errors?.[0].message },
      { status: 400 }
    );
  }

  delete parsedCharges.data[id];

  const { error } = await upsertQuoteLineAdditionalCharges(client, lineId, {
    additionalCharges: parsedCharges.data,
    updatedBy: userId
  });

  if (error) {
    return data(
      { data: null, errors: { form: error.message } },
      { status: 400 }
    );
  }

  return { data: { id }, error: null };
}
