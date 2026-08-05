import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  materialValidator,
  upsertItemStockDimension,
  upsertMaterial
} from "~/modules/items";
import { MaterialForm } from "~/modules/items/ui/Materials";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Materials`,
  to: path.to.materials,
  module: "items"
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(materialValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    stockLength,
    stockWidth,
    stockThickness,
    unitOfDimension,
    ...materialData
  } = validation.data;

  const createMaterial = await upsertMaterial(client, {
    ...materialData,
    companyId,
    customFields: setCustomFields(formData),
    createdBy: userId
  });
  if (createMaterial.error) {
    return modal
      ? data(
          createMaterial,
          await flash(
            request,
            error(createMaterial.error, "Failed to insert material")
          )
        )
      : redirect(
          path.to.materials,
          await flash(
            request,
            error(createMaterial.error, "Failed to insert material")
          )
        );
  }

  const itemId = createMaterial.data?.id;
  if (!itemId) throw new Error("Material ID not found");

  // Stock dimensions live in their own 1:1 row so the cut-list optimizer can
  // query them. Best-effort: a material without them is simply not cut stock.
  if (stockLength || stockWidth || stockThickness) {
    await upsertItemStockDimension(client, {
      itemId,
      companyId,
      stockLength: stockLength ?? null,
      stockWidth: stockWidth ?? null,
      stockThickness: stockThickness ?? null,
      unitOfDimension: unitOfDimension || "in",
      createdBy: userId
    });
  }

  return modal
    ? data(createMaterial, { status: 201 })
    : redirect(path.to.material(itemId));
}

export default function MaterialsNewRoute() {
  const initialValues = {
    id: "",
    name: "",
    description: "",
    materialFormId: "",
    materialSubstanceId: "",
    replenishmentSystem: "Buy" as const,
    defaultMethodType: "Pull from Inventory" as const,
    itemTrackingType: "Inventory" as "Inventory",
    unitOfMeasureCode: "EA",
    unitCost: 0,
    active: true,
    shelfLifeCalculateFromBom: false
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <MaterialForm initialValues={initialValues} />
    </div>
  );
}
