import { requirePermissions } from "@carbon/auth/auth.server";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { getCompanyId, proceduresQuery } from "~/utils/react-query";

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    update: "production",
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");
  const value = formData.get("value");

  if (typeof field !== "string" || typeof value !== "string") {
    return json({ error: { message: "Invalid form data" }, data: null });
  }

  switch (field) {
    case "content":
    case "name":
    case "status":
    case "processId":
      return json(
        await client
          .from("procedure")
          .update({
            [field]: value,
            updatedBy: userId,
            updatedAt: new Date().toISOString(),
          })
          .in("id", ids as string[])
      );

    default:
      return json({ error: { message: "Invalid field" }, data: null });
  }
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    proceduresQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}
