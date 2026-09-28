import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { CustomerRentalRateForm } from "~/modules/items/ui/Item";
import {
  customerItemRentalRateValidator,
  getCustomerItemRentalRate,
  upsertCustomerItemRentalRate
} from "~/modules/sales";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { itemId, rateId } = params;
  if (!itemId) throw notFound("itemId not found");
  if (!rateId) throw notFound("rateId not found");

  const rate = await getCustomerItemRentalRate(client, rateId, companyId);
  if (rate.error || rate.data.itemId !== itemId) {
    throw redirect(
      path.to.partSales(itemId),
      await flash(
        request,
        error(rate.error, "Failed to load customer rental rates")
      )
    );
  }

  return { rate: rate.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { itemId, rateId } = params;
  if (!itemId) throw notFound("itemId not found");
  if (!rateId) throw notFound("rateId not found");

  const validation = await validator(customerItemRentalRateValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await upsertCustomerItemRentalRate(client, {
    ...validation.data,
    id: rateId,
    itemId,
    companyId,
    userId
  });
  if (update.error) {
    return data(
      {},
      await flash(
        request,
        error(
          update.error,
          update.error.code === "23505"
            ? "This customer already has rental rates for this item"
            : "Failed to update customer rental rates"
        )
      )
    );
  }

  throw redirect(
    path.to.partSales(itemId),
    await flash(request, success("Updated customer rental rates"))
  );
}

export default function EditCustomerRentalRateRoute() {
  const { rate } = useLoaderData<typeof loader>();

  return (
    <CustomerRentalRateForm
      key={rate.id}
      initialValues={{
        id: rate.id,
        itemId: rate.itemId,
        currencyCode: rate.currencyCode,
        customerId: rate.customerId ?? "",
        customerTypeId: rate.customerTypeId ?? "",
        dayRate: rate.dayRate ?? undefined,
        weekRate: rate.weekRate ?? undefined,
        monthRate: rate.monthRate ?? undefined,
        validFrom: rate.validFrom ?? undefined,
        validTo: rate.validTo ?? undefined,
        notes: rate.notes ?? undefined
      }}
    />
  );
}
