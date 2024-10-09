import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { CustomerDetail } from "~/modules/sales";
import {
  CustomerForm,
  customerValidator,
  upsertCustomer,
} from "~/modules/sales";
import type { Company } from "~/modules/settings";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const formData = await request.formData();
  const validation = await validator(customerValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  if (!id) {
    throw redirect(
      path.to.customers,
      await flash(request, error(null, "Failed to update customer"))
    );
  }

  const update = await upsertCustomer(client, {
    id,
    ...data,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (update.error) {
    throw redirect(
      path.to.customers,
      await flash(request, error(update.error, "Failed to update customer"))
    );
  }

  return json(null, await flash(request, success("Updated customer")));
}

export default function CustomerEditRoute() {
  const { customerId } = useParams();
  if (!customerId) throw new Error("Could not find customerId");
  const routeData = useRouteData<{ customer: CustomerDetail }>(
    path.to.customer(customerId)
  );

  const rootRouteData = useRouteData<{ company: Company }>(
    path.to.authenticatedRoot
  );

  if (!routeData?.customer) return null;

  const company = rootRouteData?.company;
  if (!company) throw new Error("Company not found");

  const initialValues = {
    ...routeData.customer,
    name: routeData?.customer?.name ?? "",
    customerTypeId: routeData?.customer?.customerTypeId ?? undefined,
    customerStatusId: routeData?.customer?.customerStatusId ?? undefined,
    accountManagerId: routeData?.customer?.accountManagerId ?? undefined,
    taxId: routeData?.customer?.taxId ?? "",
    currencyCode: routeData?.customer?.currencyCode ?? undefined,
    phone: routeData?.customer?.phone ?? "",
    fax: routeData?.customer?.fax ?? "",
    website: routeData?.customer?.website ?? "",
    ...getCustomFields(routeData?.customer?.customFields),
  };

  return <CustomerForm key={initialValues.id} initialValues={initialValues} />;
}
