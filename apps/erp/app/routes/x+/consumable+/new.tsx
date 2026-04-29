import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { consumableValidator, upsertConsumable } from "~/modules/items";
import { ConsumableForm } from "~/modules/items/ui/Consumables";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Consumables`,
  to: path.to.consumables,
  module: "items"
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
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
    createdBy: userId
  });
  if (createConsumable.error) {
    return modal
      ? data(
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

  const itemId = createConsumable.data?.id;
  if (!itemId) throw new Error("Consumable ID not found");

  return modal
    ? data(createConsumable, { status: 201 })
    : redirect(path.to.consumable(itemId));
}

export default function ConsumablesNewRoute() {
  const initialValues = {
    id: "",
    name: "",
    description: "",
    itemTrackingType: "Non-Inventory" as "Non-Inventory",
    replenishmentSystem: "Buy" as const,
    defaultMethodType: "Purchase to Order" as const,
    unitOfMeasureCode: "EA",
    unitCost: 0,
    active: true,
    shelfLifeCalculateFromBom: false,
    tags: []
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <ConsumableForm initialValues={initialValues} />
    </div>
  );
}
