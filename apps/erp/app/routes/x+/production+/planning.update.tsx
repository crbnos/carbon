import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production",
  });

  const { items, action, locationId } = await request.json();

  if (typeof action !== "string") {
    return json({ error: { message: "Invalid form data" }, data: null });
  }

  switch (action) {
    case "order":
      console.log({ items, action, locationId });
    default:
      return json({ error: { message: "Invalid field" }, data: null });
  }
}
