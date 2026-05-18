import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { insertTag } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const name = formData.get("name");
  const table = formData.get("table");

  if (typeof name !== "string" || typeof table !== "string") {
    return data(
      { success: false, message: "Invalid form data" },
      { status: 400 }
    );
  }

  const tag = await insertTag({
    name,
    table,
    companyId,
    createdBy: userId
  });

  if (tag.error) {
    return data(
      { success: false, message: tag.error.message },
      { status: 500 }
    );
  }

  return { success: true, tag };
}
