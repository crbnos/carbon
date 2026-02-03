import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteItemCustomerPart, getItemCustomerPart } from "~/modules/items";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });
  const { itemId, customerPartToItemId } = params;
  if (!itemId) throw notFound("itemId not found");
  if (!customerPartToItemId) throw notFound("customerPartToItemId not found");

  const customerPart = await getItemCustomerPart(
    client,
    customerPartToItemId,
    companyId
  );
  if (customerPart.error) {
    throw redirect(
      path.to.partSales(itemId),
      await flash(
        request,
        error(customerPart.error, "Failed to get customer part")
      )
    );
  }

  return { customerPart: customerPart.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { itemId, customerPartToItemId } = params;
  if (!itemId) throw notFound("Could not find itemId");
  if (!customerPartToItemId)
    throw notFound("Could not find customerPartToItemId");

  const { error: deleteTypeError } = await deleteItemCustomerPart(
    client,
    customerPartToItemId,
    companyId
  );
  if (deleteTypeError) {
    throw redirect(
      path.to.partSales(itemId),
      await flash(
        request,
        error(deleteTypeError, "Failed to delete customer part")
      )
    );
  }

  throw redirect(
    path.to.partSales(itemId),
    await flash(request, success("Successfully deleted customer part"))
  );
}

export default function DeleteCustomerPartRoute() {
  const { itemId, customerPartToItemId } = useParams();
  const { customerPart } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!customerPart) return null;
  if (!itemId) throw notFound("Could not find itemId");
  if (!customerPartToItemId)
    throw notFound("Could not find customerPartToItemId");

  const onCancel = () => navigate(path.to.partSales(itemId));

  return (
    <ConfirmDelete
      action={path.to.deleteCustomerPart(itemId, customerPartToItemId)}
      name="Customer Part"
      text={`Are you sure you want to delete the customer part for ${
        customerPart?.customer?.name ?? ""
      }? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
