import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemFile, Material } from "~/modules/items";
import {
  ItemDocuments,
  MaterialForm,
  materialValidator,
  upsertMaterial,
} from "~/modules/items";
import type { ListItem } from "~/types";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(materialValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateMaterial = await upsertMaterial(client, {
    ...validation.data,
    id: itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (updateMaterial.error) {
    throw redirect(
      path.to.material(itemId),
      await flash(
        request,
        error(updateMaterial.error, "Failed to update material")
      )
    );
  }

  throw redirect(
    path.to.material(itemId),
    await flash(request, success("Updated material"))
  );
}

export default function MaterialDetailsRoute() {
  const permissions = usePermissions();

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const materialData = useRouteData<{
    materialSummary: Material;
    files: ItemFile[];
    forms: ListItem[];
    substances: ListItem[];
  }>(path.to.material(itemId));
  if (!materialData) throw new Error("Could not find material data");

  const materialInitialValues = {
    id: materialData.materialSummary?.id ?? "",
    itemId: materialData.materialSummary?.itemId ?? "",
    name: materialData.materialSummary?.name ?? "",
    description: materialData.materialSummary?.description ?? "",
    materialFormId: materialData.materialSummary?.materialFormId ?? "",
    materialSubstanceId:
      materialData.materialSummary?.materialSubstanceId ?? "",
    finish: materialData.materialSummary?.finish ?? "",
    grade: materialData.materialSummary?.grade ?? "",
    dimensions: materialData.materialSummary?.dimensions ?? "",
    replenishmentSystem:
      materialData.materialSummary?.replenishmentSystem ?? "Buy",
    defaultMethodType: materialData.materialSummary?.defaultMethodType ?? "Buy",

    itemTrackingType:
      materialData.materialSummary?.itemTrackingType ?? "Inventory",
    active: materialData.materialSummary?.active ?? true,
    unitOfMeasureCode: materialData.materialSummary?.unitOfMeasureCode ?? "EA",
    ...getCustomFields(materialData.materialSummary?.customFields ?? {}),
  };

  return (
    <VStack spacing={2} className="w-full h-full">
      <MaterialForm
        key={JSON.stringify(materialInitialValues)}
        initialValues={materialInitialValues}
      />
      {permissions.is("employee") && (
        <ItemDocuments
          files={materialData?.files ?? []}
          itemId={itemId}
          type="Material"
        />
      )}
    </VStack>
  );
}
