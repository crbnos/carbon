// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { failureModeValidator } from "~/modules/resources/resources.models";
import FailureModeForm from "~/modules/resources/ui/FailureModes/FailureModeForm";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    "resources.failureModes": "View"
  });

  const { failureModeId } = params;
  if (!failureModeId) throw notFound("failureModeId not found");

  const failureMode = await api.resources.getFailureMode({ failureModeId });

  if (failureMode.error) {
    throw redirect(
      path.to.failureModes,
      await flash(
        request,
        error(failureMode.error, "Failed to get failure mode")
      )
    );
  }

  return {
    failureMode: failureMode.data
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(failureModeValidator).request(args, {
    params: ["failureModeId"]
  });
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  const result = await api.resources.updateFailureMode({
    name: input.data.name,
    type: input.data.type,
    id: input.params.failureModeId
  });
  return respond(args.request, result).redirect(path.to.failureModes, {
    message: "Updated failure mode"
  });
}

export default function EditFailureModeRoute() {
  const { failureMode } = useLoaderData<typeof loader>();
  const dialog = useRouteDialog();

  const initialValues = {
    id: failureMode.id ?? undefined,
    name: failureMode.name ?? "",
    type: failureMode.type ?? "Maintenance"
  };

  return (
    <FailureModeForm
      key={initialValues.id}
      initialValues={initialValues}
      open={dialog.open}
      onClose={dialog.close}
    />
  );
}
