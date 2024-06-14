import { VStack } from "@carbon/react";
import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { Material } from "~/modules/items";
import {
  MaterialForm,
  materialValidator,
  upsertMaterial,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { ListItem } from "~/types";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

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
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  const materialData = useRouteData<{
    materialSummary: Material;
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
    itemGroupId: materialData.materialSummary?.itemGroupId ?? "",
    itemInventoryType:
      materialData.materialSummary?.itemInventoryType ?? "Inventory",
    active: materialData.materialSummary?.active ?? true,
    blocked: materialData.materialSummary?.blocked ?? false,
    unitOfMeasureCode: materialData.materialSummary?.unitOfMeasureCode ?? "EA",
    ...getCustomFields(materialData.materialSummary?.customFields ?? {}),
  };

  return (
    <VStack spacing={4}>
      <MaterialForm
        key={materialInitialValues.id}
        initialValues={materialInitialValues}
      />
    </VStack>
  );
}
