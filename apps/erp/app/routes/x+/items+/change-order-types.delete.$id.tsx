import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteChangeOrderType, getChangeOrderType } from "~/modules/items";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const changeOrderType = await getChangeOrderType(client, id);
  if (changeOrderType.error) {
    throw redirect(
      `${path.to.changeOrderTypes}?${getParams(request)}`,
      await flash(
        request,
        error(changeOrderType.error, "Failed to get change order category")
      )
    );
  }

  return { changeOrderType: changeOrderType.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      `${path.to.changeOrderTypes}?${getParams(request)}`,
      await flash(
        request,
        error(params, "Failed to get a change order category id")
      )
    );
  }

  const { error: deleteError } = await deleteChangeOrderType(client, id);
  if (deleteError) {
    const errorMessage =
      deleteError.code === "23503"
        ? "Change order category is used elsewhere, cannot delete"
        : "Failed to delete change order category";

    throw redirect(
      `${path.to.changeOrderTypes}?${getParams(request)}`,
      await flash(request, error(deleteError, errorMessage))
    );
  }

  throw redirect(
    `${path.to.changeOrderTypes}?${getParams(request)}`,
    await flash(request, success("Successfully deleted change order category"))
  );
}

export default function DeleteChangeOrderTypeRoute() {
  const { id } = useParams();
  const { changeOrderType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!changeOrderType) return null;
  if (!id) throw notFound("id not found");

  const onCancel = () => navigate(path.to.changeOrderTypes);
  return (
    <ConfirmDelete
      action={path.to.deleteChangeOrderType(id)}
      name={changeOrderType.name}
      text={t`Are you sure you want to delete the change order category: ${changeOrderType.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
