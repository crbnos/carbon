import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteShift, getShift } from "~/modules/people/people.service.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "people",
    role: "employee"
  });

  const { shiftId } = params;
  if (!shiftId) throw notFound("shiftId not found");

  const shift = await getShift(shiftId);
  if (shift.error) {
    throw redirect(
      path.to.shifts,
      await flash(request, error(shift.error, "Failed to get shift"))
    );
  }

  return {
    shift: shift.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "people"
  });

  const { shiftId } = params;
  if (!shiftId) {
    throw redirect(
      path.to.shifts,
      await flash(request, error(params, "Failed to get shift id"))
    );
  }

  const { error: deleteShiftError } = await deleteShift(shiftId);
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
  const { t } = useLingui();

  if (!shift) return null;
  if (!shiftId) throw notFound("shiftId not found");

  const onCancel = () => navigate(path.to.shifts);
  const name = shift.name ?? "Shift";
  const locationName = shift.locationName ?? t`unknown location`;
  return (
    <ConfirmDelete
      action={path.to.deleteShift(shiftId)}
      name={name}
      text={t`Are you sure you want to delete the shift: ${name} from ${locationName}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
