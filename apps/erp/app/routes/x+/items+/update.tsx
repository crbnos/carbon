import { requirePermissions } from "@carbon/auth/auth.server";
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
    case "grade":
    case "dimensions":
    case "finish":
    case "materialFormId":
    case "materialSubstanceId":
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

      console.log({ materialIds, field, value });

      return json(
        await client
          .from("material")
          .update({
            [field]: value,
            updatedBy: userId,
            updatedAt: new Date().toISOString(),
          })
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
