import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  customerPartValidator,
  getItemCustomerPart,
  upsertItemCustomerPart,
} from "~/modules/items";
import CustomerPartForm from "~/modules/items/ui/Item/CustomerPartForm";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  const { customerPartToItemId } = params;
  if (!customerPartToItemId)
    throw new Error("Could not find customerPartToItemId");

  const customerPart = await getItemCustomerPart(
    client,
    customerPartToItemId,
    companyId
  );

  return json({
    customerPart: customerPart?.data ?? null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    create: "parts",
    role: "employee",
  });

  const { itemId, customerPartToItemId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!customerPartToItemId)
    throw new Error("Could not find customerPartToItemId");

  const formData = await request.formData();
  const validation = await validator(customerPartValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const updatedCustomerPart = await upsertItemCustomerPart(client, {
    id: customerPartToItemId,
    ...data,
  });

  if (updatedCustomerPart.error) {
    throw redirect(
      path.to.partSales(itemId),
      await flash(
        request,
        error(updatedCustomerPart.error, "Failed to update customer part")
      )
    );
  }

  throw redirect(path.to.partSales(itemId));
}

export default function EditCustomerPartRoute() {
  const { customerPart } = useLoaderData<typeof loader>();

  const initialValues = {
    id: customerPart?.id ?? "",
    itemId: customerPart?.itemId ?? "",
    customerId: customerPart?.customerId ?? "",
    customerPartId: customerPart?.customerPartId ?? "",
    customerPartRevision: customerPart?.customerPartRevision ?? "",
  };

  return <CustomerPartForm initialValues={initialValues} />;
}
