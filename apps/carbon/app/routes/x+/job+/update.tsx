import { requirePermissions } from "@carbon/auth/auth.server";
import { tasks } from "@trigger.dev/sdk/v3";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import type { recalculateTask } from "~/trigger/recalculate";

export const config = {
  runtime: "nodejs",
};

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production",
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
    case "itemId":
      if (!value) {
        return json({ error: { message: "Invalid form data" }, data: null });
      }

      const [item, manufacturing] = await Promise.all([
        client
          .from("item")
          .select(
            "name, readableId, defaultMethodType, unitOfMeasureCode, modelUploadId"
          )
          .eq("id", value)
          .eq("companyId", companyId)
          .single(),
        client
          .from("itemReplenishment")
          .select("lotSize, scrapPercentage")
          .eq("itemId", value)
          .single(),
      ]);

      const result = await client
        .from("job")
        .update({
          itemId: value,
          unitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
          quantity:
            (manufacturing?.data?.lotSize ?? 0) === 0
              ? undefined
              : manufacturing?.data?.lotSize ?? 0,
          modelUploadId: item.data?.modelUploadId ?? null,
          scrapQuantity: Math.ceil(
            (manufacturing?.data?.lotSize ?? 0) *
              ((manufacturing?.data?.scrapPercentage ?? 0) / 100)
          ),
          updatedBy: userId,
          updatedAt: new Date().toISOString(),
        })
        .in("id", ids as string[]);

      if (!result.error) {
        await tasks.batchTrigger<typeof recalculateTask>(
          "recalculate",
          ids.map((id) => ({
            payload: {
              type: "jobRequirements",
              id: id as string,
              companyId,
              userId,
            },
          }))
        );
      }

      return json(result);
    case "customerId":
    case "deadlineType":
    case "dueDate":
    case "jobId":
    case "locationId":
    case "quantity":
    case "scrapQuantity":
    case "unitOfMeasureCode":
      return json(
        await client
          .from("job")
          .update({
            [field]: value ? value : null,
            updatedBy: userId,
            updatedAt: new Date().toISOString(),
          })
          .in("id", ids as string[])
      );
    default:
      return json({ error: { message: "Invalid field" }, data: null });
  }
}
