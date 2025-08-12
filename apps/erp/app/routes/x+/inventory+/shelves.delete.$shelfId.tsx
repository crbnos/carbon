import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteShelf, getShelf } from "~/modules/inventory";
import { getParams, path } from "~/utils/path";
import { getCompanyId } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory",
  });
  const { shelfId } = params;
  if (!shelfId) throw notFound("shelfId not found");

  const shelf = await getShelf(client, shelfId);
  if (shelf.error) {
    throw redirect(
      path.to.shelves,
      await flash(request, error(shelf.error, "Failed to get shelf"))
    );
  }

  return json({ shelf: shelf.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "inventory",
  });

  const { shelfId } = params;
  if (!shelfId) {
    throw redirect(
      path.to.shelves,
      await flash(request, error(params, "Failed to get a shelf id"))
    );
  }

  const { error: deleteShelfError } = await deleteShelf(client, shelfId);
  if (deleteShelfError) {
    throw redirect(
      path.to.shelves,
      await flash(request, error(deleteShelfError, "Failed to delete shelf"))
    );
  }

  throw redirect(
    `${path.to.shelves}?${getParams(request)}`,
    await flash(request, success("Successfully deleted shelf"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  const companyId = getCompanyId();

  window.clientCache?.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as string[];
      return queryKey[0] === "shelves" && queryKey[1] === companyId;
    },
  });

  return await serverAction();
}

export default function DeleteShelfRoute() {
  const { shelfId } = useParams();
  if (!shelfId) throw notFound("shelfId not found");

  const { shelf } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!shelfId) return null;

  const onCancel = () => navigate(path.to.shelves);

  return (
    <ConfirmDelete
      action={path.to.deleteShelf(shelfId)}
      name={shelf.name}
      text={`Are you sure you want to delete the shelf: ${shelf.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
