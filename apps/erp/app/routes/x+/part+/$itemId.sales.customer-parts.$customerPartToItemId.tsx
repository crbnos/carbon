import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  customerPartValidator,
  getItem,
  getItemCustomerPart,
  upsertItemCustomerPart
} from "~/modules/items";
import CustomerPartForm from "~/modules/items/ui/Item/CustomerPartForm";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { customerPartToItemId } = params;
  if (!customerPartToItemId)
    throw new Error("Could not find customerPartToItemId");

  const customerPart = await getItemCustomerPart(
    client,
    customerPartToItemId,
    companyId
  );

  if (!customerPart?.data) throw new Error("Could not find customer part");

  const itemData = await getItem(client, customerPart.data.itemId);
  const readableId = itemData?.data?.readableIdWithRevision;

  return {
    customerPart: customerPart?.data ?? null,
    readableId
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    create: "parts",
    role: "employee"
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

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const updatedCustomerPart = await upsertItemCustomerPart(client, {
    id: customerPartToItemId,
    ...d
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
  const { customerPart, readableId } = useLoaderData<typeof loader>();

  const initialValues = {
    id: customerPart?.id ?? "",
    itemId: customerPart?.itemId ?? "",
    readableId: readableId ?? "",
    customerId: customerPart?.customerId ?? "",
    customerPartId: customerPart?.customerPartId ?? "",
    customerPartRevision: customerPart?.customerPartRevision ?? ""
  };

  return <CustomerPartForm initialValues={initialValues} />;
}
