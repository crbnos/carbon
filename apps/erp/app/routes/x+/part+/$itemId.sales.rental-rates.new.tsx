import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useParams } from "react-router";
import { useUser } from "~/hooks";
import { CustomerRentalRateForm } from "~/modules/items/ui/Item";
import {
  customerItemRentalRateValidator,
  upsertCustomerItemRentalRate
} from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { itemId } = params;
  if (!itemId) throw notFound("itemId not found");

  const validation = await validator(customerItemRentalRateValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...rate } = validation.data;
  const insert = await upsertCustomerItemRentalRate(client, {
    ...rate,
    itemId,
    companyId,
    userId
  });
  if (insert.error) {
    return data(
      {},
      await flash(
        request,
        error(
          insert.error,
          // The unique index: one row per customer (or type), item and currency.
          insert.error.code === "23505"
            ? "This customer already has rental rates for this item"
            : "Failed to create customer rental rates"
        )
      )
    );
  }

  throw redirect(
    path.to.partSales(itemId),
    await flash(request, success("Created customer rental rates"))
  );
}

export default function NewCustomerRentalRateRoute() {
  const { itemId } = useParams();
  const { company } = useUser();
  if (!itemId) throw new Error("itemId not found");

  return (
    <CustomerRentalRateForm
      initialValues={{
        itemId,
        currencyCode: company.baseCurrencyCode,
        customerId: "",
        customerTypeId: ""
      }}
    />
  );
}
