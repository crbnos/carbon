import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import {
  batchPropertyValidator,
  upsertBatchProperty,
} from "~/modules/inventory";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(batchPropertyValidator).validate(formData);

  if (validation.error) {
    return json({
      success: false,
      error: "Invalid form data",
    });
  }

  const { listOptions, ...data } = validation.data;

  const upsert = await upsertBatchProperty(client, {
    ...data,
    listOptions: data.dataType === "list" ? listOptions : undefined,
    companyId,
    userId,
  });

  if (upsert.error) {
    console.error(upsert.error);
    return json({
      success: false,
      error: upsert.error.message,
    });
  }

  return json({
    success: true,
  });
}
