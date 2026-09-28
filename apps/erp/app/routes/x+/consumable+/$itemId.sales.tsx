import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  getSalesRuleAssignmentsForItem,
  getSalesRulesList
} from "@carbon/ee/rules";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getItemUnitSalePrice,
  itemUnitSalePriceValidator,
  upsertItemUnitSalePrice
} from "~/modules/items";
import { ItemSalePriceForm } from "~/modules/items/ui/Item";
import { SalesRuleAssignmentsList } from "~/modules/sales/ui/SalesRules";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [consumableUnitSalePrice, salesRuleAssignments, salesRuleLibrary] =
    await Promise.all([
      getItemUnitSalePrice(client, itemId, companyId),
      getSalesRuleAssignmentsForItem(client, { itemId, companyId }),
      getSalesRulesList(client, companyId)
    ]);

  if (consumableUnitSalePrice.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(
          consumableUnitSalePrice.error,
          "Failed to load consumable unit sale price"
        )
      )
    );
  }

  return {
    consumableUnitSalePrice: consumableUnitSalePrice.data,
    salesRuleAssignments: salesRuleAssignments.data ?? [],
    salesRuleLibrary: salesRuleLibrary.data ?? [],
    itemId
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(itemUnitSalePriceValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateConsumableUnitSalePrice = await upsertItemUnitSalePrice(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updateConsumableUnitSalePrice.error) {
    throw redirect(
      path.to.consumable(itemId),
      await flash(
        request,
        error(
          updateConsumableUnitSalePrice.error,
          "Failed to update consumable sale price"
        )
      )
    );
  }

  throw redirect(
    path.to.consumableSales(itemId),
    await flash(request, success("Updated consumable sale price"))
  );
}

export default function ConsumableSalesRoute() {
  const {
    consumableUnitSalePrice,
    salesRuleAssignments,
    salesRuleLibrary,
    itemId
  } = useLoaderData<typeof loader>();

  const initialValues = {
    ...consumableUnitSalePrice,
    salesUnitOfMeasureCode:
      consumableUnitSalePrice?.salesUnitOfMeasureCode ?? "",
    ...getCustomFields(consumableUnitSalePrice.customFields),
    itemId: itemId
  };

  return (
    <VStack spacing={4} className="p-4">
      <ItemSalePriceForm
        key={initialValues.itemId}
        initialValues={initialValues}
      />
      <SalesRuleAssignmentsList
        itemId={itemId}
        assignments={salesRuleAssignments as never}
        library={salesRuleLibrary as never}
      />
    </VStack>
  );
}
