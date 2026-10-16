// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { useNavigate } from "react-router";
import { useUser } from "~/hooks";
import { workCenterValidator } from "~/modules/resources/resources.models";
import { WorkCenterForm } from "~/modules/resources/ui";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(workCenterValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.createWorkCenter({
    ...input.data,
    customFields: input.formData && setCustomFields(input.formData)
  });
  // The modal form reads the result and closes itself.
  if (input.formData?.get("type") === "modal") return result;
  return respond(args.request, result).redirect(path.to.workCenters);
}

export default function NewWorkCenterRoute() {
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.workCenters);
  const { defaults } = useUser();

  const initialValues = {
    alwaysOn: false,
    defaultStandardFactor: "Minutes/Piece" as "Minutes/Piece",
    departmentId: undefined as string | undefined,
    description: "",
    laborRate: 0,
    locationId: defaults?.locationId ?? "",
    machineRate: 0,
    name: "",
    overheadRate: 0,
    processes: [],
    shifts: [],
    batchCapacity: undefined as number | undefined,
    minimumBatchQuantity: undefined as number | undefined
  };

  return <WorkCenterForm onClose={onClose} initialValues={initialValues} />;
}
