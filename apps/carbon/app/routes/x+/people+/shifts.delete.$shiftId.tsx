import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteShift, getShift } from "~/modules/people";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "people",
    role: "employee",
  });

  const { shiftId } = params;
  if (!shiftId) throw notFound("shiftId not found");

  const shift = await getShift(client, shiftId);
  if (shift.error) {
    throw redirect(
      path.to.shifts,
      await flash(request, error(shift.error, "Failed to get shift"))
    );
  }

  return json({
    shift: shift.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "people",
  });

  const { shiftId } = params;
  if (!shiftId) {
    throw redirect(
      path.to.shifts,
      await flash(request, error(params, "Failed to get shift id"))
    );
  }

  const { error: deleteShiftError } = await deleteShift(client, shiftId);
  if (deleteShiftError) {
    throw redirect(
      path.to.shifts,
      await flash(request, error(deleteShiftError, "Failed to delete shift"))
    );
  }

  throw redirect(
    path.to.shifts,
    await flash(request, success("Successfully deleted shift"))
  );
}

export default function DeleteShiftRoute() {
  const { shiftId } = useParams();
  const { shift } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!shift) return null;
  if (!shiftId) throw notFound("shiftId not found");

  const onCancel = () => navigate(path.to.shifts);

  return (
    <ConfirmDelete
      action={path.to.deleteShift(shiftId)}
      name={shift.name ?? "Shift"}
      text={`Are you sure you want to delete the shift: ${shift.name} from ${
        shift.locationName ?? "unknown location"
      }? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
