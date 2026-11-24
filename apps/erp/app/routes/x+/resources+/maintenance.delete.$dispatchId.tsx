// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { getMaintenanceDispatch } from "~/modules/resources/resources.service";
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["dispatchId"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.deleteMaintenanceDispatch({
    dispatchId: input.params.dispatchId
  });
  return respond(args.request, result).redirect(
    `${path.to.maintenanceDispatches}?${getParams(args.request)}`,
    { message: "Successfully deleted maintenance dispatch" }
  );
}

export default function DeleteMaintenanceDispatchRoute() {
  const { dispatchId } = useParams();
  const { dispatch } = useLoaderData<typeof loader>();
  const dialog = useRouteDialog(path.to.maintenanceDispatches);
  const { t } = useLingui();

  if (!dispatch) return null;
  if (!dispatchId) throw notFound("dispatchId not found");

  return (
    <ConfirmDelete
      action={path.to.deleteMaintenanceDispatch(dispatchId)}
      name={dispatch.maintenanceDispatchId}
      text={t`Are you sure you want to delete this maintenance dispatch? This cannot be undone.`}
      isOpen={dialog.open}
      onCancel={dialog.close}
    />
  );
}
