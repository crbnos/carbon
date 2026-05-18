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
import { deleteLocation, getLocation } from "~/modules/resources";
import { path } from "~/utils/path";
import { getCompanyId, locationsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const { locationId } = params;
  if (!locationId) throw notFound("locationId not found");

  const location = await getLocation(locationId);
  if (location.error) {
    throw redirect(
      path.to.locations,
      await flash(request, error(location.error, "Failed to get location"))
    );
  }

  return {
    location: location.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "resources"
  });

  const { locationId } = params;
  if (!locationId) {
    throw redirect(
      path.to.locations,
      await flash(request, error(params, "Failed to get location id"))
    );
  }

  const { error: deleteLocationError } = await deleteLocation(locationId);
  if (deleteLocationError) {
    throw redirect(
      path.to.locations,
      await flash(
        request,
        error(deleteLocationError, "Failed to delete location")
      )
    );
  }

  throw redirect(
    path.to.locations,
    await flash(request, success("Successfully deleted location"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    locationsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function DeleteLocationRoute() {
  const { locationId } = useParams();
  const { location } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!location) return null;
  if (!locationId) throw new Error("locationId is not found");

  const onCancel = () => navigate(path.to.locations);
  const name = location.name;
  return (
    <ConfirmDelete
      action={path.to.deleteLocation(locationId)}
      name={name}
      text={t`Are you sure you want to delete the location: ${name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
