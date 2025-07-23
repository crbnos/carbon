import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { json, type ActionFunctionArgs } from "@vercel/remix";

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const formData = await request.formData();
  const items = formData.getAll("items");
  const field = formData.get("field");
  const value = formData.get("value");

  if (typeof field !== "string" || typeof value !== "string") {
    return json({ error: { message: "Invalid form data" }, data: null });
  }

  switch (field) {
    case "defaultMethodType":
    case "itemTrackingType":
    case "name":
    case "replenishmentSystem":
    case "unitOfMeasureCode":
      // For other fields, just update the specified field
      if (field === "replenishmentSystem" && value !== "Buy and Make") {
        return json(
          await client
            .from("item")
            .update({
              // @ts-expect-error
              [field]: value,
              // @ts-expect-error
              defaultMethodType: value,
              updatedBy: userId,
              updatedAt: new Date().toISOString(),
            })
            .in("id", items as string[])
        );
      }
      if (field === "defaultMethodType" && value !== "Pick") {
        return json(
          await client
            .from("item")
            .update({
              // @ts-expect-error
              defaultMethodType: value,
              // @ts-expect-error
              replenishmentSystem: value,
              updatedBy: userId,
              updatedAt: new Date().toISOString(),
            })
            .in("id", items as string[])
        );
      }
      return json(
        await client
          .from("item")
          .update({
            [field]: value,
            updatedBy: userId,
            updatedAt: new Date().toISOString(),
          })
          .in("id", items as string[])
      );
    case "gradeId":
    case "dimensionId":
    case "finishId":
    case "materialFormId":
    case "materialSubstanceId":
    case "materialTypeId":
      const materialItems = await client
        .from("item")
        .select("readableId")
        .in("id", items as string[]);
      const materialIds = [
        ...new Set(materialItems.data?.map((item) => item.readableId) ?? []),
      ];
      if (materialIds.length === 0) {
        return json({ error: { message: "No materials found" }, data: null });
      }

      let updateData: Database["public"]["Tables"]["material"]["Update"] = {
        [field]: value || null,
        updatedBy: userId,
        updatedAt: new Date().toISOString(),
      };

      // If substance changes, reset finishId, gradeId, and materialTypeId
      if (field === "materialSubstanceId") {
        updateData.finishId = null;
        updateData.gradeId = null;
        updateData.materialTypeId = null;
      }

      // If form changes, reset dimensionId and materialTypeId
      if (field === "materialFormId") {
        updateData.dimensionId = null;
        updateData.materialTypeId = null;
      }

      return json(
        await client
          .from("material")
          .update(updateData)
          .in("id", materialIds as string[])
      );
    case "active":
      return json(
        await client
          .from("item")
          .update({
            active: value === "on",
            updatedBy: userId,
            updatedAt: new Date().toISOString(),
          })
          .in("id", items as string[])
      );
    default:
      return json({ error: { message: "Invalid field" }, data: null });
  }
}
