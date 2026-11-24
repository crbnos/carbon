// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { failureModeValidator } from "~/modules/resources/resources.models";
import FailureModeForm from "~/modules/resources/ui/FailureModes/FailureModeForm";
import { getParams, path, requestReferrer } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "resources"
  });

  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(failureModeValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.createFailureMode({
    name: input.data.name,
    type: input.data.type
  });
  // The modal form reads the result and closes itself.
  if (input.formData?.get("formType") === "modal") return result;
  const list = `${path.to.failureModes}?${getParams(args.request)}`;
  return respond(args.request, result).redirect(list, {
    message: "Failure mode created",
    onError: requestReferrer(args.request) ?? list
  });
}

export default function NewFailureModeRoute() {
  const dialog = useRouteDialog();
  const initialValues = {
    name: "",
    type: "Maintenance" as const
  };

  return (
    <FailureModeForm
      initialValues={initialValues}
      open={dialog.open}
      onClose={dialog.close}
    />
  );
}
