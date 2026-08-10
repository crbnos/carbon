import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteChangeNoticeType, getChangeNoticeType } from "~/modules/items";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const changeNoticeType = await getChangeNoticeType(client, id, companyId);
  if (changeNoticeType.error) {
    throw redirect(
      `${path.to.changeNoticeTypes}?${getParams(request)}`,
      await flash(
        request,
        error(changeNoticeType.error, "Failed to get change notice category")
      )
    );
  }

  return { changeNoticeType: changeNoticeType.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      `${path.to.changeNoticeTypes}?${getParams(request)}`,
      await flash(
        request,
        error(params, "Failed to get a change notice category id")
      )
    );
  }

  const { error: deleteError } = await deleteChangeNoticeType(
    client,
    id,
    companyId
  );
  if (deleteError) {
    const errorMessage =
      deleteError.code === "23503"
        ? "Change notice category is used elsewhere, cannot delete"
        : "Failed to delete change notice category";

    throw redirect(
      `${path.to.changeNoticeTypes}?${getParams(request)}`,
      await flash(request, error(deleteError, errorMessage))
    );
  }

  throw redirect(
    `${path.to.changeNoticeTypes}?${getParams(request)}`,
    await flash(request, success("Successfully deleted change notice category"))
  );
}

export default function DeleteChangeNoticeTypeRoute() {
  const { id } = useParams();
  const { changeNoticeType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!changeNoticeType) return null;
  if (!id) throw notFound("id not found");

  const onCancel = () => navigate(path.to.changeNoticeTypes);
  return (
    <ConfirmDelete
      action={path.to.deleteChangeNoticeType(id)}
      name={changeNoticeType.name}
      text={t`Are you sure you want to delete the change notice category: ${changeNoticeType.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
