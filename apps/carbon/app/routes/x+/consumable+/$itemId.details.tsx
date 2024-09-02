import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import { usePermissions, useRouteData } from "~/hooks";
import type { Consumable, ItemFile } from "~/modules/items";
import {
  ConsumableForm,
  ItemDocuments,
  consumableValidator,
  upsertConsumable,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
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
  const validation = await validator(consumableValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateConsumable = await upsertConsumable(client, {
    ...validation.data,
    id: itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (updateConsumable.error) {
    throw redirect(
      path.to.consumable(itemId),
      await flash(
        request,
        error(updateConsumable.error, "Failed to update consumable")
      )
    );
  }

  throw redirect(
    path.to.consumable(itemId),
    await flash(request, success("Updated consumable"))
  );
}

export default function ConsumableDetailsRoute() {
  const permissions = usePermissions();

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const consumableData = useRouteData<{
    consumableSummary: Consumable;
    files: ItemFile[];
  }>(path.to.consumable(itemId));
  if (!consumableData) throw new Error("Could not find consumable data");

  const consumableInitialValues = {
    id: consumableData.consumableSummary?.id ?? "",
    itemId: consumableData.consumableSummary?.itemId ?? "",
    name: consumableData.consumableSummary?.name ?? "",
    description: consumableData.consumableSummary?.description ?? "",
    replenishmentSystem:
      consumableData.consumableSummary?.replenishmentSystem ?? "Buy",
    defaultMethodType:
      consumableData.consumableSummary?.defaultMethodType ?? "Buy",
    itemTrackingType:
      consumableData.consumableSummary?.itemTrackingType ?? "Inventory",
    active: consumableData.consumableSummary?.active ?? true,
    unitOfMeasureCode:
      consumableData.consumableSummary?.unitOfMeasureCode ?? "EA",
    ...getCustomFields(consumableData.consumableSummary?.customFields ?? {}),
  };

  return (
    <VStack spacing={2} className="w-full h-full">
      <ConsumableForm
        key={consumableInitialValues.id}
        initialValues={consumableInitialValues}
      />
      {permissions.is("employee") && (
        <ItemDocuments
          files={consumableData?.files ?? []}
          itemId={itemId}
          type="Consumable"
        />
      )}
    </VStack>
  );
}
