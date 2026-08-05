import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteCutList, getCutList } from "~/modules/production";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const cutList = await getCutList(client, id, companyId);
  if (cutList.error) {
    throw redirect(
      `${path.to.cutLists}?${getParams(request)}`,
      await flash(request, error(cutList.error, "Failed to get cut list"))
    );
  }

  return { cutList: cutList.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "production"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      `${path.to.cutLists}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get a cut list id"))
    );
  }

  const { error: deleteError } = await deleteCutList(client, id, companyId);
  if (deleteError) {
    const message =
      deleteError.code === "23503"
        ? "Cut list is referenced elsewhere, cannot delete"
        : "Failed to delete cut list";

    throw redirect(
      `${path.to.cutLists}?${getParams(request)}`,
      await flash(request, error(deleteError, message))
    );
  }

  throw redirect(
    `${path.to.cutLists}?${getParams(request)}`,
    await flash(request, success("Successfully deleted cut list"))
  );
}

export default function DeleteCutListRoute() {
  const { id } = useParams();
  const { cutList } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!cutList) return null;
  if (!id) throw notFound("id not found");

  return (
    <ConfirmDelete
      action={path.to.deleteCutList(id)}
      name={cutList.cutListId ?? "cut list"}
      text={t`Are you sure you want to delete ${cutList.cutListId}? This cannot be undone.`}
      onCancel={() => navigate(path.to.cutLists)}
    />
  );
}
