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
  getItemCustomerParts,
  getItemUnitSalePrice,
  itemUnitSalePriceValidator,
  upsertItemUnitSalePrice
} from "~/modules/items";
import { ItemSalePriceForm } from "~/modules/items/ui/Item";
import CustomerParts from "~/modules/items/ui/Item/CustomerParts";
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

  const [
    partUnitSalePrice,
    customerParts,
    salesRuleAssignments,
    salesRuleLibrary
  ] = await Promise.all([
    getItemUnitSalePrice(client, itemId, companyId),
    getItemCustomerParts(client, itemId, companyId),
    getSalesRuleAssignmentsForItem(client, { itemId, companyId }),
    getSalesRulesList(client, companyId)
  ]);

  if (partUnitSalePrice.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(partUnitSalePrice.error, "Failed to load part unit sale price")
      )
    );
  }

  return {
    partUnitSalePrice: partUnitSalePrice.data,
    customerParts: customerParts.data,
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

  const updatePartUnitSalePrice = await upsertItemUnitSalePrice(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updatePartUnitSalePrice.error) {
    throw redirect(
      path.to.part(itemId),
      await flash(
        request,
        error(updatePartUnitSalePrice.error, "Failed to update part sale price")
      )
    );
  }

  throw redirect(
    path.to.partSales(itemId),
    await flash(request, success("Updated part sale price"))
  );
}

export default function PartSalesRoute() {
  const {
    customerParts,
    partUnitSalePrice,
    salesRuleAssignments,
    salesRuleLibrary,
    itemId
  } = useLoaderData<typeof loader>();

  const initialValues = {
    ...partUnitSalePrice,
    salesUnitOfMeasureCode: partUnitSalePrice?.salesUnitOfMeasureCode ?? "",
    ...getCustomFields(partUnitSalePrice.customFields),
    itemId: itemId
  };

  return (
    <VStack spacing={4} className="p-4">
      <ItemSalePriceForm
        key={initialValues.itemId}
        initialValues={initialValues}
      />
      {customerParts ? (
        <CustomerParts customerParts={customerParts} itemId={itemId} />
      ) : null}
      <SalesRuleAssignmentsList
        itemId={itemId}
        assignments={salesRuleAssignments as never}
        library={salesRuleLibrary as never}
      />
    </VStack>
  );
}
