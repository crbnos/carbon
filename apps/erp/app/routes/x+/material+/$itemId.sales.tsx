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

  const [materialUnitSalePrice, salesRuleAssignments, salesRuleLibrary] =
    await Promise.all([
      getItemUnitSalePrice(client, itemId, companyId),
      getSalesRuleAssignmentsForItem(client, { itemId, companyId }),
      getSalesRulesList(client, companyId)
    ]);

  if (materialUnitSalePrice.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(
          materialUnitSalePrice.error,
          "Failed to load material unit sale price"
        )
      )
    );
  }

  return {
    materialUnitSalePrice: materialUnitSalePrice.data,
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

  const updateMaterialUnitSalePrice = await upsertItemUnitSalePrice(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updateMaterialUnitSalePrice.error) {
    throw redirect(
      path.to.material(itemId),
      await flash(
        request,
        error(
          updateMaterialUnitSalePrice.error,
          "Failed to update material sale price"
        )
      )
    );
  }

  throw redirect(
    path.to.materialSales(itemId),
    await flash(request, success("Updated material sale price"))
  );
}

export default function MaterialSalesRoute() {
  const {
    materialUnitSalePrice,
    salesRuleAssignments,
    salesRuleLibrary,
    itemId
  } = useLoaderData<typeof loader>();

  const initialValues = {
    ...materialUnitSalePrice,
    salesUnitOfMeasureCode: materialUnitSalePrice?.salesUnitOfMeasureCode ?? "",
    ...getCustomFields(materialUnitSalePrice.customFields),
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
