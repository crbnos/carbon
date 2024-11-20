import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const table = formData.get("table");
  const value = formData.getAll("value");

  const result = await client
    // @ts-expect-error
    .from(table as string)
    .update({
      tags: value,
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    })
    .in(getIdField(table as string), ids as string[]);

  if (result.error) {
    console.error(result.error);
  }

  return json(result);
}

function getIdField(table: string) {
  switch (table) {
    case "part":
    case "tool":
    case "material":
    case "consumable":
    case "service":
    case "fixture":
      return "itemId";
    case "job":
    default:
      return "id";
  }
}
