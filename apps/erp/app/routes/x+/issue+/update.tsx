import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { FunctionRegion } from "@supabase/supabase-js";
import { json, type ActionFunctionArgs } from "@vercel/remix";

export const config = {
  runtime: "nodejs",
};

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality",
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");
  const value = formData.get("value");

  if (
    typeof field !== "string" ||
    (typeof value !== "string" && value !== null)
  ) {
    return json({ error: { message: "Invalid form data" }, data: null });
  }

  switch (field) {
    case "investigationTypes":
    case "requiredActions":
    case "approvalRequirements":
      const arrayValue = value ? value.split(",") : [];
      const update = await client
        .from("nonConformance")
        .update({
          [field]: arrayValue,
          updatedBy: userId,
          updatedAt: new Date().toISOString(),
        })
        .in("id", ids as string[]);

      if (update.error) {
        console.error(update.error);
        return json({
          error: { message: "Failed to update issue" },
          data: null,
        });
      }

      const serviceRole = await getCarbonServiceRole();
      await Promise.all(
        ids.map(async (id) => {
          await serviceRole.functions.invoke("create", {
            body: {
              type: "nonConformanceTasks",
              id,
              companyId,
              userId,
            },
            region: FunctionRegion.UsEast1,
          });
        })
      );

      return json({ data: update.data });
    case "source":
    case "priority":
    case "name":
    case "description":
    case "locationId":
    case "nonConformanceTypeId":
    case "openDate":
    case "dueDate":
    case "closeDate":
    case "quantity":
    case "itemId":
    case "supplierId":
      return json(
        await client
          .from("nonConformance")
          .update({
            [field]: value ? value : null,
            updatedBy: userId,
            updatedAt: new Date().toISOString(),
          })
          .in("id", ids as string[])
      );
    default:
      return json({
        error: { message: `Invalid field: ${field}` },
        data: null,
      });
  }
}
