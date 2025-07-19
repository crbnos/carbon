import { json } from "@remix-run/react";

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { deleteReceiptLine } from "~/modules/inventory";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "inventory",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const lineDelete = await deleteReceiptLine(client, id);

  if (lineDelete.error) {
    return json({
      success: false,
      message: lineDelete.error.message,
    });
  }

  return json({
    success: true,
    message: "Receipt line deleted successfully",
  });
}
