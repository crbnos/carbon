import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { recalculateTask } from "@carbon/jobs/trigger/recalculate";
import { tasks } from "@trigger.dev/sdk/v3";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import {
  recalculateJobRequirements,
  upsertJobMethod,
} from "~/modules/production";

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

  if (typeof field !== "string") {
    return json({ error: { message: "Invalid form data" }, data: null });
  }

  const serviceRole = await getCarbonServiceRole();

  if (field === "delete") {
    return json(
      await client
        .from("job")
        .delete()
        .in("id", ids as string[])
        .eq("companyId", companyId)
    );
  }
  if (typeof value !== "string" && value !== null) {
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
            "name, readableIdWithRevision, defaultMethodType, unitOfMeasureCode, modelUploadId"
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

      const [itemUpdate, makeMethodUpdate] = await Promise.all([
        client
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
          .in("id", ids as string[])
          .eq("companyId", companyId),

        client
          .from("jobMakeMethod")
          .update({
            itemId: value,
            updatedBy: userId,
            updatedAt: new Date().toISOString(),
          })
          .in("jobId", ids as string[])
          .is("parentMaterialId", null)
          .eq("companyId", companyId),
      ]);

      if (itemUpdate.error) {
        return json(itemUpdate);
      }

      if (makeMethodUpdate.error) {
        return json(makeMethodUpdate);
      }

      for await (const id of ids) {
        const upsertMethod = await upsertJobMethod(serviceRole, "itemToJob", {
          sourceId: value,
          targetId: id as string,
          companyId,
          userId,
        });

        if (upsertMethod.error) {
          json(upsertMethod.error);
        }

        await tasks.trigger<typeof recalculateTask>("recalculate", {
          type: "jobRequirements",
          id: id as string,
          companyId,
          userId,
        });
      }

      return json(itemUpdate);
    case "customerId":
    case "deadlineType":
    case "dueDate":
    case "jobId":
    case "locationId":
    case "shelfId":
    case "startDate":
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
          .eq("companyId", companyId)
      );
    case "quantity":
    case "scrapQuantity":
      const quantityUpdate = await client
        .from("job")
        .update({
          [field]: value ? value : null,
          updatedBy: userId,
          updatedAt: new Date().toISOString(),
        })
        .in("id", ids as string[])
        .eq("companyId", companyId);

      if (quantityUpdate.error) {
        return json(quantityUpdate);
      }

      for await (const id of ids) {
        const recalculate = await recalculateJobRequirements(serviceRole, {
          id: id as string,
          companyId,
          userId,
        });
        if (recalculate.error) {
          console.error(recalculate.error);
          return json(recalculate);
        }
      }

      return json(quantityUpdate);
    case "salesOrderId":
    case "salesOrderLineId":
      if (!value) {
        return json(
          await client
            .from("job")
            .update({ salesOrderId: null, salesOrderLineId: null })
            .in("id", ids as string[])
            .eq("companyId", companyId)
        );
      } else {
        return json({
          error: { message: `Invalid value: ${value} for field: ${field}` },
          data: null,
        });
      }
    default:
      return json({
        error: { message: `Invalid field: ${field}` },
        data: null,
      });
  }
}
