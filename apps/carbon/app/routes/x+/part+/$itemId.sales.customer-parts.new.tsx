import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { customerPartValidator, upsertItemCustomerPart } from "~/modules/items";
import CustomerPartForm from "~/modules/items/ui/Item/CustomerPartForm";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    create: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(customerPartValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createCustomerPart = await upsertItemCustomerPart(client, {
    ...data,
    companyId,
  });

  if (createCustomerPart.error) {
    const flashMessage =
      // 23505 means the unique constraint on ("customerId", "itemId") was violated
      createCustomerPart.error.code == "23505"
        ? "Customer Part record already defined for customer"
        : "Failed to create customer part";

    throw redirect(
      path.to.partSales(itemId),
      await flash(request, error(createCustomerPart.error, flashMessage))
    );
  }

  throw redirect(path.to.partSales(itemId));
}

export default function NewCustomerPartRoute() {
  const { itemId } = useParams();

  if (!itemId) throw new Error("itemId not found");

  const initialValues = {
    itemId: itemId,
    customerId: "",
    customerPartId: "",
    customerPartRevision: "",
  };

  return <CustomerPartForm initialValues={initialValues} />;
}
