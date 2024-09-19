import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteGroup, getGroup } from "~/modules/users";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "users",
    role: "employee",
  });

  const { groupId } = params;
  if (!groupId) throw notFound("groupId not found");

  const group = await getGroup(client, groupId);
  if (group.error) {
    throw redirect(
      path.to.groups,
      await flash(request, error(group.error, "Failed to get group"))
    );
  }

  return json({ group: group.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "users",
  });

  const { groupId } = params;
  if (!groupId) {
    throw redirect(
      path.to.groups,
      await flash(request, error(params, "Failed to get an group id"))
    );
  }

  const { error: deleteGroupError } = await deleteGroup(client, groupId);
  if (deleteGroupError) {
    throw redirect(
      path.to.groups,
      await flash(request, error(deleteGroupError, "Failed to delete group"))
    );
  }

  throw redirect(
    path.to.groups,
    await flash(request, success("Successfully deleted group"))
  );
}

export default function DeleteEmployeeTypeRoute() {
  const { groupId } = useParams();
  const { group } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!group) return null;
  if (!groupId) throw new Error("groupId not found");

  const onCancel = () => navigate(path.to.groups);

  return (
    <ConfirmDelete
      action={path.to.deleteGroup(groupId)}
      name={group.name}
      text={`Are you sure you want to delete the group: ${group.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
