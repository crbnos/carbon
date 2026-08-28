import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteWarrantyTerm, getWarrantyTerm } from "~/modules/sales";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const warrantyTerm = await getWarrantyTerm(client, id, companyId);
  if (warrantyTerm.error) {
    throw redirect(
      `${path.to.warrantyTerms}?${getParams(request)}`,
      await flash(
        request,
        error(warrantyTerm.error, "Failed to get warranty term")
      )
    );
  }

  return { warrantyTerm: warrantyTerm.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "sales"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      `${path.to.warrantyTerms}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get a warranty term id"))
    );
  }

  const { error: deleteWarrantyTermError } = await deleteWarrantyTerm(
    client,
    id,
    companyId
  );
  if (deleteWarrantyTermError) {
    const errorMessage =
      deleteWarrantyTermError.code === "23503"
        ? "Return reason is used elsewhere, cannot delete"
        : "Failed to delete warranty term";

    throw redirect(
      `${path.to.warrantyTerms}?${getParams(request)}`,
      await flash(request, error(deleteWarrantyTermError, errorMessage))
    );
  }

  throw redirect(
    `${path.to.warrantyTerms}?${getParams(request)}`,
    await flash(request, success("Successfully deleted warranty term"))
  );
}

export default function DeleteWarrantyTermRoute() {
  const { t } = useLingui();
  const { id } = useParams();
  const { warrantyTerm } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!warrantyTerm) return null;
  if (!id) throw notFound("id not found");

  const onCancel = () => navigate(path.to.warrantyTerms);
  return (
    <ConfirmDelete
      action={path.to.deleteWarrantyTerm(id)}
      name={warrantyTerm.name}
      text={t`Are you sure you want to delete the warranty term: ${warrantyTerm.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
