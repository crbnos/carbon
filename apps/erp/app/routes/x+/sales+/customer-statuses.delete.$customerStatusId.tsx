import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteCustomerStatus, getCustomerStatus } from "~/modules/sales";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });
  const { customerStatusId } = params;
  if (!customerStatusId) throw notFound("customerStatusId not found");

  const customerStatus = await getCustomerStatus(customerStatusId);
  if (customerStatus.error) {
    throw redirect(
      `${path.to.customerStatuses}?${getParams(request)}`,
      await flash(
        request,
        error(customerStatus.error, "Failed to get customer status")
      )
    );
  }

  return { customerStatus: customerStatus.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "sales"
  });

  const { customerStatusId } = params;
  if (!customerStatusId) {
    throw redirect(
      `${path.to.customerStatuses}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get an customer status id"))
    );
  }

  const { error: deleteStatusError } =
    await deleteCustomerStatus(customerStatusId);
  if (deleteStatusError) {
    throw redirect(
      `${path.to.customerStatuses}?${getParams(request)}`,
      await flash(
        request,
        error(deleteStatusError, "Failed to delete customer status")
      )
    );
  }

  throw redirect(
    `${path.to.customerStatuses}?${getParams(request)}`,
    await flash(request, success("Successfully deleted customer status"))
  );
}

export default function DeleteCustomerStatusRoute() {
  const { t } = useLingui();
  const { customerStatusId } = useParams();
  const { customerStatus } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!customerStatus) return null;
  if (!customerStatusId) throw notFound("customerStatusId not found");

  const onCancel = () => navigate(path.to.customerStatuses);
  return (
    <ConfirmDelete
      action={path.to.deleteCustomerStatus(customerStatusId)}
      name={customerStatus.name}
      text={t`Are you sure you want to delete the customer status: ${customerStatus.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
