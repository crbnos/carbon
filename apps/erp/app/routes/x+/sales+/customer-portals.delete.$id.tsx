import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteCustomerPortal, getCustomerPortal } from "~/modules/shared";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const customerPortal = await getCustomerPortal(client, id);
  if (customerPortal.error) {
    throw redirect(
      `${path.to.customerPortals}?${getParams(request)}`,
      await flash(
        request,
        error(customerPortal.error, "Failed to get customer portal")
      )
    );
  }

  return { customerPortal: customerPortal.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "sales"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "CUSTOMER_PORTALS",
    redirectTo: path.to.customerPortals
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      `${path.to.customerPortals}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get a customer portal id"))
    );
  }

  const { error: deleteCustomerPortalError } = await deleteCustomerPortal(
    client,
    id
  );
  if (deleteCustomerPortalError) {
    const errorMessage =
      deleteCustomerPortalError.code === "23503"
        ? "Customer portal is used elsewhere, cannot delete"
        : "Failed to delete customer portal";

    throw redirect(
      `${path.to.customerPortals}?${getParams(request)}`,
      await flash(request, error(deleteCustomerPortalError, errorMessage))
    );
  }

  throw redirect(
    `${path.to.customerPortals}?${getParams(request)}`,
    await flash(request, success("Successfully deleted customer portal"))
  );
}

export default function DeleteCustomerPortalRoute() {
  const { t } = useLingui();
  const { id } = useParams();
  const { customerPortal } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!customerPortal) return null;
  if (!id) throw notFound("id not found");

  const customerName = customerPortal.customer?.name || "Unknown Customer";
  const onCancel = () => navigate(path.to.customerPortals);

  return (
    <ConfirmDelete
      action={path.to.deleteCustomerPortal(id)}
      name={customerName}
      text={t`Are you sure you want to delete the customer portal for: ${customerName}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
