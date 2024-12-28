import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { Spinner, VStack } from "@carbon/react";
import { Await, useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { Suspense } from "react";
import { usePermissions, useRouteData } from "~/hooks";
import type { Consumable, ItemFile } from "~/modules/items";
import { consumableValidator, upsertConsumable } from "~/modules/items";
import { ConsumableForm } from "~/modules/items/ui/Consumables";
import { ItemDocuments } from "~/modules/items/ui/Item";

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
    files: Promise<ItemFile[]>;
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
    tags: consumableData.consumableSummary?.tags ?? [],
    ...getCustomFields(consumableData.consumableSummary?.customFields ?? {}),
  };

  return (
    <VStack spacing={2} className="w-full h-full">
      <ConsumableForm
        key={JSON.stringify(consumableInitialValues)}
        initialValues={consumableInitialValues}
      />
      {permissions.is("employee") && (
        <Suspense
          fallback={
            <div className="flex w-full h-[full] rounded bg-gradient-to-tr from-background to-card items-center justify-center">
              <Spinner className="h-10 w-10" />
            </div>
          }
        >
          <Await resolve={consumableData?.files}>
            {(files) => (
              <ItemDocuments
                files={files ?? []}
                itemId={itemId}
                type="Consumable"
              />
            )}
          </Await>
        </Suspense>
      )}
    </VStack>
  );
}
