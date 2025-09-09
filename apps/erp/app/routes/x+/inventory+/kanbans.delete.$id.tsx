import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteKanban, getKanban } from "~/modules/inventory";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory",
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const kanban = await getKanban(client, id);
  if (kanban.error) {
    throw redirect(
      path.to.kanbans,
      await flash(request, error(kanban.error, "Failed to get kanban"))
    );
  }

  return json({ kanban: kanban.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "inventory",
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.kanbans,
      await flash(request, error(params, "Failed to get a kanban id"))
    );
  }

  const { error: deleteKanbanError } = await deleteKanban(client, id);
  if (deleteKanbanError) {
    throw redirect(
      path.to.kanbans,
      await flash(request, error(deleteKanbanError, "Failed to delete kanban"))
    );
  }

  throw redirect(
    `${path.to.kanbans}?${getParams(request)}`,
    await flash(request, success("Successfully deleted kanban"))
  );
}

export default function DeleteKanbanRoute() {
  const { id } = useParams();
  if (!id) throw notFound("id not found");

  const { kanban } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!id) return null;

  const onCancel = () => navigate(path.to.kanbans);

  return (
    <ConfirmDelete
      action={path.to.deleteKanban(id)}
      name={`Kanban for ${kanban.item?.name || kanban.itemId}`}
      text={`Are you sure you want to delete this kanban card? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
