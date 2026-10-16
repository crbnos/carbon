// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { BatchRules } from "@carbon/utils";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  batchRuleInitialValues,
  processValidator
} from "~/modules/resources/resources.models";
import { getProcess } from "~/modules/resources/resources.service";
import { ProcessForm } from "~/modules/resources/ui";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources"
  });

  const { processId } = params;
  if (!processId) throw notFound("processId was not found");

  const process = await getProcess(client, processId);

  if (process.error) {
    throw redirect(
      path.to.processes,
      await flash(request, error(process.error, "Failed to get process"))
    );
  }

  return {
    process: process.data
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(processValidator).request(args, {
    params: ["processId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.updateProcess({
    ...input.data,
    id: input.params.processId,
    customFields: input.formData && setCustomFields(input.formData)
  });
  // The modal form reads the result and closes itself.
  if (input.formData?.get("type") === "modal") return result;
  return respond(args.request, result).redirect(path.to.processes);
}

export default function ProcessRoute() {
  const { process } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();
  const onClose = () => closeRoute();

  const initialValues = {
    id: process.id!,
    name: process.name!,
    processType: process.processType ?? "Process",
    defaultStandardFactor: process.defaultStandardFactor ?? "Minutes/Piece",
    workCenters: process.workCenters ?? [],
    // @ts-expect-error
    suppliers: (process.suppliers ?? []).map((s) => s.id) ?? [],
    ...getCustomFields(process.customFields),
    completeAllOnScan: process.completeAllOnScan ?? false,
    batchable: process.batchable ?? false,
    batchType: process.batchType ?? ("Sequential" as const),
    requiresAbility: process.requiresAbility ?? false,
    ...batchRuleInitialValues(process.batchRules as BatchRules | null)
  };

  return <ProcessForm initialValues={initialValues} onClose={onClose} />;
}
