import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { insertTag } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const name = formData.get("name");
  const table = formData.get("table");

  if (typeof name !== "string" || typeof table !== "string") {
    return json(
      { success: false, message: "Invalid form data" },
      { status: 400 }
    );
  }

  const tag = await insertTag(client, {
    name,
    table,
    companyId,
    createdBy: userId,
  });

  if (tag.error) {
    return json(
      { success: false, message: tag.error.message },
      { status: 500 }
    );
  }

  return json({ success: true, tag });
}
