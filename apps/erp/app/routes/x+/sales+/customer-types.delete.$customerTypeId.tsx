import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteCustomerType, getCustomerType } from "~/modules/sales";
import { getParams, path } from "~/utils/path";
import { customerTypesQuery, getCompanyId } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales"
  });
  const { customerTypeId } = params;
  if (!customerTypeId) throw notFound("customerTypeId not found");

  const customerType = await getCustomerType(customerTypeId);
  if (customerType.error) {
    throw redirect(
      `${path.to.customerTypes}?${getParams(request)}`,
      await flash(
        request,
        error(customerType.error, "Failed to get customer type")
      )
    );
  }

  return { customerType: customerType.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "sales"
  });

  const { customerTypeId } = params;
  if (!customerTypeId) {
    throw redirect(
      `${path.to.customerTypes}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get an customer type id"))
    );
  }

  const { error: deleteTypeError } = await deleteCustomerType(customerTypeId);
  if (deleteTypeError) {
    throw redirect(
      `${path.to.customerTypes}?${getParams(request)}`,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete customer type")
      )
    );
  }

  throw redirect(
    `${path.to.customerTypes}?${getParams(request)}`,
    await flash(request, success("Successfully deleted customer type"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    customerTypesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function DeleteCustomerTypeRoute() {
  const { t } = useLingui();
  const { customerTypeId } = useParams();
  const { customerType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!customerTypeId) throw new Error("customerTypeId not found");

  const onCancel = () => navigate(path.to.customerTypes);

  return (
    <ConfirmDelete
      action={path.to.deleteCustomerType(customerTypeId)}
      name={customerType.name}
      text={t`Are you sure you want to delete the customer type: ${customerType.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
