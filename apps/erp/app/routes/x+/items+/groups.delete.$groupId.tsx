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
import { deleteItemPostingGroup, getItemPostingGroup } from "~/modules/items";
import { getParams, path } from "~/utils/path";
import { getCompanyId, itemPostingGroupsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts"
  });
  const { groupId } = params;
  if (!groupId) throw notFound("groupId not found");

  const itemPostingGroup = await getItemPostingGroup(groupId);
  if (itemPostingGroup.error) {
    throw redirect(
      path.to.itemPostingGroups,
      await flash(
        request,
        error(itemPostingGroup.error, "Failed to get item group")
      )
    );
  }

  return { itemPostingGroup: itemPostingGroup.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "parts"
  });

  const { groupId } = params;
  if (!groupId) {
    throw redirect(
      path.to.itemPostingGroups,
      await flash(request, error(params, "Failed to get an item group id"))
    );
  }

  const { error: deleteTypeError } = await deleteItemPostingGroup(groupId);
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

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    itemPostingGroupsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function DeleteItemPostingGroupRoute() {
  const { groupId } = useParams();
  if (!groupId) throw new Error("groupId not found");

  const { itemPostingGroup } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!itemPostingGroup) return null;

  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteItemPostingGroup(groupId)}
      name={itemPostingGroup.name}
      text={t`Are you sure you want to delete the item group: ${itemPostingGroup.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
