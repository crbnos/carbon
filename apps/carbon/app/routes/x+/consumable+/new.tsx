import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  ConsumableForm,
  consumableValidator,
  upsertConsumable,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

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
    itemInventoryType: "Non-Inventory" as "Non-Inventory",
    unitOfMeasureCode: "EA",
    pullFromInventory: true,
    active: true,
  };

  return (
    <div className="w-1/2 max-w-[600px] min-w-[420px] mx-auto mt-8">
      <ConsumableForm initialValues={initialValues} />
    </div>
  );
}
