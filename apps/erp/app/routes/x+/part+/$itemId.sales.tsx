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
import { useRouteData } from "~/hooks";
import type { PartSummary } from "~/modules/items";
import {
  getItemCustomerParts,
  getItemUnitSalePrice,
  itemUnitSalePriceValidator,
  upsertItemUnitSalePrice
} from "~/modules/items";
import { ItemRentalRateForm, ItemSalePriceForm } from "~/modules/items/ui/Item";
import CustomerParts from "~/modules/items/ui/Item/CustomerParts";
import {
  getItemRentalRate,
  itemRentalRateValidator,
  upsertItemRentalRate
} from "~/modules/sales";
import { SalesRuleAssignmentsList } from "~/modules/sales/ui/SalesRules";
import { getCompany } from "~/modules/settings";
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
    company,
    salesRuleAssignments,
    salesRuleLibrary
  ] = await Promise.all([
    getItemUnitSalePrice(client, itemId, companyId),
    getItemCustomerParts(client, itemId, companyId),
    getCompany(client, companyId),
    getSalesRuleAssignmentsForItem(client, { itemId, companyId }),
    getSalesRulesList(client, companyId)
  ]);

  // The rate ladder is kept per currency; the item page edits the company's
  // base-currency ladder. A user without sales access reads no row (RLS), which
  // renders as an empty ladder.
  const baseCurrencyCode = company.data?.baseCurrencyCode ?? "";
  const rentalRate = baseCurrencyCode
    ? await getItemRentalRate(client, itemId, companyId, baseCurrencyCode)
    : null;

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
    rentalRate: rentalRate?.data ?? null,
    baseCurrencyCode,
    salesRuleAssignments: salesRuleAssignments.data ?? [],
    salesRuleLibrary: salesRuleLibrary.data ?? [],
    itemId
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();

  if (formData.get("intent") === "rentalRate") {
    const rentalValidation = await validator(itemRentalRateValidator).validate(
      formData
    );
    if (rentalValidation.error) {
      return validationError(rentalValidation.error);
    }

    const { id: _id, ...rate } = rentalValidation.data;
    const upsertRentalRate = await upsertItemRentalRate(client, {
      ...rate,
      itemId,
      companyId,
      userId
    });
    if (upsertRentalRate.error) {
      throw redirect(
        path.to.partSales(itemId),
        await flash(
          request,
          error(upsertRentalRate.error, "Failed to update rental rates")
        )
      );
    }

    throw redirect(
      path.to.partSales(itemId),
      await flash(request, success("Updated rental rates"))
    );
  }

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
    rentalRate,
    baseCurrencyCode,
    salesRuleAssignments,
    salesRuleLibrary,
    itemId
  } = useLoaderData<typeof loader>();

  // v1 fleet units are serialized, so only a serial-tracked item can be rented.
  const partData = useRouteData<{ partSummary: PartSummary }>(
    path.to.part(itemId)
  );
  const isRentable = partData?.partSummary?.itemTrackingType === "Serial";

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
      {isRentable && baseCurrencyCode ? (
        <ItemRentalRateForm
          key={`${itemId}-rental`}
          initialValues={{
            id: rentalRate?.id ?? undefined,
            itemId,
            currencyCode: baseCurrencyCode,
            dayRate: rentalRate?.dayRate ?? undefined,
            weekRate: rentalRate?.weekRate ?? undefined,
            monthRate: rentalRate?.monthRate ?? undefined
          }}
        />
      ) : null}
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
