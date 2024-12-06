import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { consumableValidator, upsertConsumable } from "~/modules/items";
import { ConsumableForm } from "~/modules/items/ui/Consumables";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Consumables",
  to: path.to.consumables,
  module: "items",
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(consumableValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const createConsumable = await upsertConsumable(client, {
    ...validation.data,
    companyId,
    customFields: setCustomFields(formData),
    createdBy: userId,
  });
  if (createConsumable.error) {
    return modal
      ? json(
          createConsumable,
          await flash(
            request,
            error(createConsumable.error, "Failed to insert consumable")
          )
        )
      : redirect(
          path.to.consumables,
          await flash(
            request,
            error(createConsumable.error, "Failed to insert consumable")
          )
        );
  }

  const itemId = createConsumable.data?.itemId;
  if (!itemId) throw new Error("Consumable ID not found");

  return modal
    ? json(createConsumable, { status: 201 })
    : redirect(path.to.consumable(itemId));
}

export default function ConsumablesNewRoute() {
  const initialValues = {
    id: "",
    name: "",
    description: "",
    itemTrackingType: "Non-Inventory" as "Non-Inventory",
    replenishmentSystem: "Buy" as const,
    defaultMethodType: "Buy" as const,
    unitOfMeasureCode: "EA",
    unitCost: 0,
    active: true,
    tags: [],
  };

  return (
    <div className="max-w-[50rem] w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <ConsumableForm initialValues={initialValues} />
    </div>
  );
}
