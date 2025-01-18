import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getItemCost,
  getItemCostHistory,
  itemCostValidator,
  upsertItemCost,
} from "~/modules/items";
import { ItemCostingForm } from "~/modules/items/ui/Item";
import { ItemCostHistoryChart } from "~/modules/items/ui/Item/ItemCostHistoryChart";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [itemCost, itemCostHistory] = await Promise.all([
    getItemCost(client, itemId, companyId),
    getItemCostHistory(client, itemId, companyId),
  ]);

  if (itemCost.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(itemCost.error, "Failed to load consumable costing")
      )
    );
  }

  return json({
    itemCost: itemCost.data,
    itemCostHistory: itemCostHistory.data ?? [],
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(itemCostValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateItemCost = await upsertItemCost(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateItemCost.error) {
    throw redirect(
      path.to.consumable(itemId),
      await flash(
        request,
        error(updateItemCost.error, "Failed to update consumable costing")
      )
    );
  }

  throw redirect(
    path.to.consumableCosting(itemId),
    await flash(request, success("Updated consumable costing"))
  );
}

export default function ConsumableCostingRoute() {
  const { itemCost, itemCostHistory } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={2} className="p-2">
      <ItemCostingForm
        key={itemCost.itemId}
        initialValues={{
          ...itemCost,
          ...getCustomFields(itemCost.customFields),
        }}
      />
      <ItemCostHistoryChart
        readableId={itemCost.readableId}
        itemCostHistory={itemCostHistory}
      />
    </VStack>
  );
}
