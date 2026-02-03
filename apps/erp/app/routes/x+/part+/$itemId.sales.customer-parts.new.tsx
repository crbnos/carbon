import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import {
  customerPartValidator,
  getItem,
  upsertItemCustomerPart
} from "~/modules/items";
import CustomerPartForm from "~/modules/items/ui/Item/CustomerPartForm";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const itemData = await getItem(client, itemId);
  const readableId = itemData?.data?.readableIdWithRevision;

  return {
    readableId
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    create: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(customerPartValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const createCustomerPart = await upsertItemCustomerPart(client, {
    ...d,
    companyId
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
  const { readableId } = useLoaderData<typeof loader>();

  if (!itemId) throw new Error("itemId not found");

  const initialValues = {
    itemId: itemId,
    customerId: "",
    customerPartId: "",
    customerPartRevision: "",
    readableId: readableId ?? ""
  };

  return <CustomerPartForm initialValues={initialValues} />;
}
