import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";

const logger = getLogger("erp", "tags");

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
      updatedAt: new Date().toISOString()
    })
    .in(getIdField(table as string), ids as string[]);

  if (result.error) {
    logger.error(result.error);
  }

  return result;
}

function getIdField(table: string) {
  switch (table) {
    case "part":
    case "tool":
    case "material":
    case "consumable":
    case "service":
    case "fixture":
    case "job":
    case "jobOperation":
    case "methodOperation":
    case "quoteOperation":
    default:
      return "id";
  }
}
