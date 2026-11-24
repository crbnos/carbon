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
import { getFailureMode } from "~/modules/resources/resources.service";
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["failureModeId"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.deleteFailureMode({
    failureModeId: input.params.failureModeId
  });
  const list = `${path.to.failureModes}?${getParams(args.request)}`;
  return respond(args.request, result).redirect(list, {
    message: "Successfully deleted failure mode",
    onError: list
  });
}

export default function DeleteFailureModeRoute() {
  const { failureModeId } = useParams();
  const { failureMode } = useLoaderData<typeof loader>();
  const dialog = useRouteDialog(path.to.failureModes);
  const { t } = useLingui();

  if (!failureMode) return null;
  if (!failureModeId) throw notFound("failureModeId not found");

  const name = failureMode.name;
  return (
    <ConfirmDelete
      action={path.to.deleteFailureMode(failureModeId)}
      name={name}
      text={t`Are you sure you want to delete the failure mode: ${name}? This cannot be undone.`}
      isOpen={dialog.open}
      onCancel={dialog.close}
    />
  );
}
