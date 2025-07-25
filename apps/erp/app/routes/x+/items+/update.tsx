import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { getCompanySettings } from "~/modules/settings";
import { getMaterialDescription, getMaterialId } from "~/utils/items";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
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
            .eq("companyId", companyId)
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
            .eq("companyId", companyId)
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
          .eq("companyId", companyId)
      );
    case "gradeId":
    case "dimensionId":
    case "finishId":
    case "materialFormId":
    case "materialSubstanceId":
    case "materialTypeId":
      const settings = await getCompanySettings(client, companyId);

      if (settings.data?.materialGeneratedIds) {
        let name = "";
        let code = "";
        if (field === "materialSubstanceId") {
          const materialSubstance = await client
            .from("materialSubstance")
            .select("name, code")
            .eq("code", value)
            .single();
          name = materialSubstance.data?.name ?? "";
          code = materialSubstance.data?.code ?? "";
        }
        if (field === "materialFormId") {
          const materialForm = await client
            .from("materialForm")
            .select("name, code")
            .eq("code", value)
            .single();
          name = materialForm.data?.name ?? "";
          code = materialForm.data?.code ?? "";
        }
        if (field === "materialTypeId") {
          const materialType = await client
            .from("materialType")
            .select("name, code")
            .eq("code", value)
            .single();
          name = materialType.data?.name ?? "";
          code = materialType.data?.code ?? "";
        }
        if (field === "finishId") {
          const finish = await client
            .from("materialFinish")
            .select("name")
            .eq("id", value)
            .single();
          name = finish.data?.name ?? "";
        }
        if (field === "gradeId") {
          const grade = await client
            .from("materialGrade")
            .select("name")
            .eq("id", value)
            .single();

          name = grade.data?.name ?? "";
        }
        if (field === "dimensionId") {
          const dimension = await client
            .from("materialDimension")
            .select("name")
            .eq("id", value)
            .single();
          name = dimension.data?.name ?? "";
        }

        for await (const id of items as string[]) {
          const item = await client
            .from("item")
            .select("readableId")
            .eq("id", id)
            .eq("companyId", companyId)
            .single();

          const readableId = item.data?.readableId;

          if (readableId) {
            const [materialDetails, relatedItems] = await Promise.all([
              client
                .rpc("get_material_naming_details", { readable_id: readableId })
                .single(),
              client
                .from("item")
                .select("id")
                .eq("readableId", readableId)
                .eq("companyId", companyId),
            ]);

            if (materialDetails.data) {
              const namingDetails = materialDetails.data;
              if (field === "materialSubstanceId") {
                namingDetails.substance = name;
                namingDetails.substanceCode = code;
              }
              if (field === "materialFormId") {
                namingDetails.shape = name;
                namingDetails.shapeCode = code;
              }
              if (field === "materialTypeId") {
                namingDetails.materialType = name;
                namingDetails.materialTypeCode = code;
              }
              if (field === "finishId") {
                namingDetails.finish = name;
              }
              if (field === "gradeId") {
                namingDetails.grade = name;
              }
              if (field === "dimensionId") {
                namingDetails.dimensions = name;
              }

              const newMaterialId = getMaterialId(namingDetails);
              const newDescription = getMaterialDescription(namingDetails);

              const relatedItemIds = relatedItems.data?.map((item) => item.id);

              if (relatedItemIds) {
                const itemUpdateResult = await client
                  .from("item")
                  .update({ readableId: newMaterialId, name: newDescription })
                  .in("id", relatedItemIds as string[])
                  .eq("companyId", companyId);

                if (itemUpdateResult.error) {
                  return json(itemUpdateResult);
                }
              }

              let updateData: Database["public"]["Tables"]["material"]["Update"] =
                {
                  [field]: value || null,
                  id: newMaterialId,
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

              const update = await client
                .from("material")
                .update(updateData)
                .eq("id", readableId)
                .eq("companyId", companyId);

              if (update.error) {
                return json({
                  error: { message: update.error.message },
                  data: null,
                });
              }
            }
          }
        }

        return json({
          data: null,
          error: null,
        });
      } else {
        const materialItems = await client
          .from("item")
          .select("readableId")
          .in("id", items as string[])
          .eq("companyId", companyId);
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
            .eq("companyId", companyId)
        );
      }
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
          .eq("companyId", companyId)
      );
    default:
      return json({ error: { message: "Invalid field" }, data: null });
  }
}
