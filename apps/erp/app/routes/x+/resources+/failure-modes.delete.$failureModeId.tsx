import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteFailureMode, getFailureMode } from "~/modules/resources";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });
  const { failureModeId } = params;
  if (!failureModeId) throw notFound("failureModeId not found");

  const failureMode = await getFailureMode(client, failureModeId);
  if (failureMode.error) {
    throw redirect(
      `${path.to.failureModes}?${getParams(request)}`,
      await flash(
        request,
        error(failureMode.error, "Failed to get failure mode")
      )
    );
  }

  return { failureMode: failureMode.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "resources"
  });

  const { failureModeId } = params;
  if (!failureModeId) {
    throw redirect(
      `${path.to.failureModes}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get a failure mode id"))
    );
  }

  const { error: deleteFailureModeError } = await deleteFailureMode(
    client,
    failureModeId
  );
  if (deleteFailureModeError) {
    const errorMessage =
      deleteFailureModeError.code === "23503"
        ? "Failure mode is used elsewhere, cannot delete"
        : "Failed to delete failure mode";

    throw redirect(
      `${path.to.failureModes}?${getParams(request)}`,
      await flash(request, error(deleteFailureModeError, errorMessage))
    );
  }

  throw redirect(
    `${path.to.failureModes}?${getParams(request)}`,
    await flash(request, success("Successfully deleted failure mode"))
  );
}

export default function DeleteFailureModeRoute() {
  const { failureModeId } = useParams();
  const { failureMode } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!failureMode) return null;
  if (!failureModeId) throw notFound("failureModeId not found");

  const onCancel = () => navigate(path.to.failureModes);
  return (
    <ConfirmDelete
      action={path.to.deleteFailureMode(failureModeId)}
      name={failureMode.name}
      text={`Are you sure you want to delete the failure mode: ${failureMode.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
