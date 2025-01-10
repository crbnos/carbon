import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteNoQuoteReason, getNoQuoteReason } from "~/modules/sales";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
    role: "employee",
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const noQuoteReason = await getNoQuoteReason(client, id);
  if (noQuoteReason.error) {
    throw redirect(
      `${path.to.customerStatuses}?${getParams(request)}`,
      await flash(
        request,
        error(noQuoteReason.error, "Failed to get no quote reason")
      )
    );
  }

  return json({ noQuoteReason: noQuoteReason.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "sales",
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      `${path.to.noQuoteReasons}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get an no quote reason id"))
    );
  }

  const { error: deleteNoQuoteReasonError } = await deleteNoQuoteReason(
    client,
    id
  );
  if (deleteNoQuoteReasonError) {
    const errorMessage =
      deleteNoQuoteReasonError.code === "23503"
        ? "No quote reason is used elsewhere, cannot delete"
        : "Failed to delete noQuote reason";

    throw redirect(
      `${path.to.noQuoteReasons}?${getParams(request)}`,
      await flash(request, error(deleteNoQuoteReasonError, errorMessage))
    );
  }

  throw redirect(
    `${path.to.noQuoteReasons}?${getParams(request)}`,
    await flash(request, success("Successfully deleted noQuote reason"))
  );
}

export default function DeleteNoQuoteReasonRoute() {
  const { id } = useParams();
  const { noQuoteReason } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!noQuoteReason) return null;
  if (!id) throw notFound("id not found");

  const onCancel = () => navigate(path.to.noQuoteReasons);
  return (
    <ConfirmDelete
      action={path.to.deleteNoQuoteReason(id)}
      name={noQuoteReason.name}
      text={`Are you sure you want to delete the no quote reason: ${noQuoteReason.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
