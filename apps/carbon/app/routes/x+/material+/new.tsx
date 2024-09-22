import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  MaterialForm,
  materialValidator,
  upsertMaterial,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Materials",
  to: path.to.materials,
  module: "items",
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(materialValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const createMaterial = await upsertMaterial(client, {
    ...validation.data,
    companyId,
    customFields: setCustomFields(formData),
    createdBy: userId,
  });
  if (createMaterial.error) {
    return modal
      ? json(
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

  const itemId = createMaterial.data?.itemId;
  if (!itemId) throw new Error("Material ID not found");

  return modal
    ? json(createMaterial, { status: 201 })
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
    defaultMethodType: "Buy" as const,
    itemTrackingType: "Inventory" as "Inventory",
    unitOfMeasureCode: "EA",
    unitCost: 0,
    active: true,
  };

  return (
    <div className="w-1/2 max-w-[600px] min-w-[420px] mx-auto mt-8">
      <MaterialForm initialValues={initialValues} />
    </div>
  );
}
