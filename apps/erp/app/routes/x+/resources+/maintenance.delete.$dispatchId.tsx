import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteMaintenanceDispatch,
  getMaintenanceDispatch
} from "~/modules/resources";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });
  const { dispatchId } = params;
  if (!dispatchId) throw notFound("dispatchId not found");

  const dispatch = await getMaintenanceDispatch(client, dispatchId);
  if (dispatch.error) {
    throw redirect(
      `${path.to.maintenanceDispatches}?${getParams(request)}`,
      await flash(
        request,
        error(dispatch.error, "Failed to get maintenance dispatch")
      )
    );
  }

  return { dispatch: dispatch.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "production"
  });

  const { dispatchId } = params;
  if (!dispatchId) {
    throw redirect(
      `${path.to.maintenanceDispatches}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get a dispatch id"))
    );
  }

  const { error: deleteError } = await deleteMaintenanceDispatch(
    client,
    dispatchId
  );
  if (deleteError) {
    const errorMessage =
      deleteError.code === "23503"
        ? "Dispatch has related records, cannot delete"
        : "Failed to delete maintenance dispatch";

    throw redirect(
      `${path.to.maintenanceDispatches}?${getParams(request)}`,
      await flash(request, error(deleteError, errorMessage))
    );
  }

  throw redirect(
    `${path.to.maintenanceDispatches}?${getParams(request)}`,
    await flash(request, success("Successfully deleted maintenance dispatch"))
  );
}

export default function DeleteMaintenanceDispatchRoute() {
  const { dispatchId } = useParams();
  const { dispatch } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!dispatch) return null;
  if (!dispatchId) throw notFound("dispatchId not found");

  const onCancel = () => navigate(path.to.maintenanceDispatches);
  return (
    <ConfirmDelete
      action={path.to.deleteMaintenanceDispatch(dispatchId)}
      name={dispatch.maintenanceDispatchId}
      text={`Are you sure you want to delete this maintenance dispatch? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
