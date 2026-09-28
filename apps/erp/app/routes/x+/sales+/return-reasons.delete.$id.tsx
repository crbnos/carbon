import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteReturnReason, getReturnReason } from "~/modules/sales";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const returnReason = await getReturnReason(client, id);
  if (returnReason.error) {
    throw redirect(
      `${path.to.returnReasons}?${getParams(request)}`,
      await flash(
        request,
        error(returnReason.error, "Failed to get return reason")
      )
    );
  }

  return { returnReason: returnReason.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "sales"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      `${path.to.returnReasons}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get a return reason id"))
    );
  }

  const { error: deleteReturnReasonError } = await deleteReturnReason(
    client,
    id
  );
  if (deleteReturnReasonError) {
    const errorMessage =
      deleteReturnReasonError.code === "23503"
        ? "Return reason is used elsewhere, cannot delete"
        : "Failed to delete return reason";

    throw redirect(
      `${path.to.returnReasons}?${getParams(request)}`,
      await flash(request, error(deleteReturnReasonError, errorMessage))
    );
  }

  throw redirect(
    `${path.to.returnReasons}?${getParams(request)}`,
    await flash(request, success("Successfully deleted return reason"))
  );
}

export default function DeleteReturnReasonRoute() {
  const { t } = useLingui();
  const { id } = useParams();
  const { returnReason } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!returnReason) return null;
  if (!id) throw notFound("id not found");

  const onCancel = () => navigate(path.to.returnReasons);
  return (
    <ConfirmDelete
      action={path.to.deleteReturnReason(id)}
      name={returnReason.name}
      text={t`Are you sure you want to delete the return reason: ${returnReason.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
