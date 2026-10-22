// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { serviceTemplateValidator } from "~/modules/service/service.models";
import ServiceTemplateForm from "~/modules/service/ui/Templates/ServiceTemplateForm";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "service" });
  return null;
}

/** Creates a service template and opens it to build its work. */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(serviceTemplateValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.service.createServiceTemplate(input.data);
  if (!result.data) {
    return respond(args.request, result).redirect(path.to.serviceTemplates);
  }
  return respond(args.request, result).redirect(
    path.to.serviceTemplate(result.data.id),
    { message: "Service template created" }
  );
}

export default function NewServiceTemplateRoute() {
  const closeRoute = useCloseRoute();
  return <ServiceTemplateForm onClose={() => closeRoute()} />;
}
