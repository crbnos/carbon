import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import { ConfirmDelete } from "~/components/Modals";
import { deleteItemGroup, getItemGroup } from "~/modules/parts";
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

  const itemGroup = await getItemGroup(client, groupId);
  if (itemGroup.error) {
    throw redirect(
      path.to.itemGroups,
      await flash(request, error(itemGroup.error, "Failed to get item group"))
    );
  }

  return json({ itemGroup: itemGroup.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "parts",
  });

  const { groupId } = params;
  if (!groupId) {
    throw redirect(
      path.to.itemGroups,
      await flash(request, error(params, "Failed to get an item group id"))
    );
  }

  const { error: deleteTypeError } = await deleteItemGroup(client, groupId);
  if (deleteTypeError) {
    throw redirect(
      `${path.to.itemGroups}?${getParams(request)}`,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete item group")
      )
    );
  }

  throw redirect(
    path.to.itemGroups,
    await flash(request, success("Successfully deleted item group"))
  );
}

export default function DeleteItemGroupRoute() {
  const { groupId } = useParams();
  if (!groupId) throw new Error("groupId not found");

  const { itemGroup } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!itemGroup) return null;

  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteItemGroup(groupId)}
      name={itemGroup.name}
      text={`Are you sure you want to delete the item group: ${itemGroup.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
