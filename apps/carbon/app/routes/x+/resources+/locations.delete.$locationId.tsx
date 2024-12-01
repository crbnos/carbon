import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteLocation, getLocation } from "~/modules/resources";
import { path } from "~/utils/path";
import { getCompanyId, locationsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
    role: "employee",
  });

  const { locationId } = params;
  if (!locationId) throw notFound("locationId not found");

  const location = await getLocation(client, locationId);
  if (location.error) {
    throw redirect(
      path.to.locations,
      await flash(request, error(location.error, "Failed to get location"))
    );
  }

  return json({
    location: location.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "resources",
  });

  const { locationId } = params;
  if (!locationId) {
    throw redirect(
      path.to.locations,
      await flash(request, error(params, "Failed to get location id"))
    );
  }

  const { error: deleteLocationError } = await deleteLocation(
    client,
    locationId
  );
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
  window.queryClient?.setQueryData(
    locationsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function DeleteLocationRoute() {
  const { locationId } = useParams();
  const { location } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!location) return null;
  if (!locationId) throw new Error("locationId is not found");

  const onCancel = () => navigate(path.to.locations);

  return (
    <ConfirmDelete
      action={path.to.deleteLocation(locationId)}
      name={location.name}
      text={`Are you sure you want to delete the location: ${location.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
