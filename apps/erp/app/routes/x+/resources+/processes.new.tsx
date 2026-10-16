// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { useNavigate } from "react-router";
import {
  batchRuleInitialValues,
  processValidator
} from "~/modules/resources/resources.models";
import { ProcessForm } from "~/modules/resources/ui";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(processValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.createProcess({
    ...input.data,
    customFields: input.formData && setCustomFields(input.formData)
  });
  // The modal form reads the result and closes itself.
  if (input.formData?.get("type") === "modal") return result;
  return respond(args.request, result).redirect(path.to.processes, {
    message: "Process created"
  });
}

export default function NewProcessRoute() {
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.processes);

  const initialValues = {
    name: "",
    processType: "Process" as const,
    defaultStandardFactor: "Minutes/Piece" as const,
    completeAllOnScan: false,
    batchable: false,
    batchType: "Sequential" as const,
    requiresAbility: false,
    ...batchRuleInitialValues(null)
  };

  return <ProcessForm initialValues={initialValues} onClose={onClose} />;
}
