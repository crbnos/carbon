// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteShift, getShift } from "~/modules/people";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "people",
    role: "employee"
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

  return {
    shift: shift.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "people"
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
