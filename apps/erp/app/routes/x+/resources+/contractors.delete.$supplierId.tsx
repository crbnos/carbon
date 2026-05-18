import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteContractor, getContractor } from "~/modules/resources";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const { supplierId } = params;
  if (!supplierId) throw notFound("supplierId not found");

  const contractor = await getContractor(supplierId);
  if (contractor.error) {
    throw redirect(
      path.to.contractors,
      await flash(request, error(contractor.error, "Failed to get contractor"))
    );
  }

  return {
    contractor: contractor.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "resources"
  });

  const { supplierId } = params;
  if (!supplierId) {
    throw redirect(
      path.to.contractors,
      await flash(request, error(params, "Failed to get contractor id"))
    );
  }

  const { error: deleteContractorError } = await deleteContractor(supplierId);
  if (deleteContractorError) {
    throw redirect(
      path.to.contractors,
      await flash(
        request,
        error(deleteContractorError, "Failed to delete contractor")
      )
    );
  }

  throw redirect(
    path.to.contractors,
    await flash(request, success("Successfully deleted contractor"))
  );
}

export default function DeleteContractorRoute() {
  const { t } = useLingui();
  const { contractor } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!contractor.supplierContactId)
    throw notFound("supplierContactId not found");

  const onCancel = () => navigate(path.to.contractors);
  const name = contractor.fullName ?? contractor.email ?? "Unknown";

  return (
    <ConfirmDelete
      action={path.to.deleteContractor(contractor.supplierContactId)}
      name={name}
      text={t`Are you sure you want to delete the contractor: ${name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
