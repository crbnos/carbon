import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import { ConfirmDelete } from "~/components/Modals";
import { deleteItemPostingGroup, getItemPostingGroup } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { notFound } from "~/utils/http";
import { getParams, path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
  });
  const { groupId } = params;
  if (!groupId) throw notFound("groupId not found");

  const itemPostingGroup = await getItemPostingGroup(client, groupId);
  if (itemPostingGroup.error) {
    throw redirect(
      path.to.itemPostingGroups,
      await flash(
        request,
        error(itemPostingGroup.error, "Failed to get item group")
      )
    );
  }

  return json({ itemPostingGroup: itemPostingGroup.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "parts",
  });

  const { groupId } = params;
  if (!groupId) {
    throw redirect(
      path.to.itemPostingGroups,
      await flash(request, error(params, "Failed to get an item group id"))
    );
  }

  const { error: deleteTypeError } = await deleteItemPostingGroup(
    client,
    groupId
  );
  if (deleteTypeError) {
    throw redirect(
      `${path.to.itemPostingGroups}?${getParams(request)}`,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete item group")
      )
    );
  }

  throw redirect(
    path.to.itemPostingGroups,
    await flash(request, success("Successfully deleted item group"))
  );
}

export default function DeleteItemPostingGroupRoute() {
  const { groupId } = useParams();
  if (!groupId) throw new Error("groupId not found");

  const { itemPostingGroup } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!itemPostingGroup) return null;

  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteItemPostingGroup(groupId)}
      name={itemPostingGroup.name}
      text={`Are you sure you want to delete the item group: ${itemPostingGroup.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
