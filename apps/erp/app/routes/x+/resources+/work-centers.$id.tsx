// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { getWorkCenterCapitalCost } from "~/modules/accounting/accounting.service";
import { workCenterValidator } from "~/modules/resources/resources.models";
import { getWorkCenter } from "~/modules/resources/resources.service";
import { WorkCenterForm } from "~/modules/resources/ui";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("Invalid work center id");

  const [workCenter, capitalCost] = await Promise.all([
    getWorkCenter(client, id),
    getWorkCenterCapitalCost(client, id, companyId)
  ]);
  if (workCenter.error) {
    throw redirect(
      path.to.workCenters,
      await flash(
        request,
        error(workCenter.error, "Failed to fetch work center")
      )
    );
  }

  // The capital-cost panel is read-only context on the edit form: a failed
  // read renders no panel rather than blocking the work center itself.
  return {
    workCenter: workCenter.data,
    capitalCost: capitalCost.data ?? undefined
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(workCenterValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.updateWorkCenter({
    ...input.data,
    id: input.params.id,
    customFields: input.formData && setCustomFields(input.formData)
  });
  return respond(args.request, result).redirect(path.to.workCenters, {
    message: "Updated work center"
  });
}

export default function WorkCenterRoute() {
  const { workCenter, capitalCost } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.workCenters);

  const initialValues = {
    id: workCenter?.id ?? undefined,
    alwaysOn: workCenter?.alwaysOn ?? false,
    defaultStandardFactor: workCenter?.defaultStandardFactor ?? "Minutes/Piece",
    departmentId: workCenter?.departmentId ?? undefined,
    description: workCenter?.description ?? "",
    laborRate: workCenter?.laborRate ?? 0,
    locationId: workCenter?.locationId ?? "",
    machineRate: workCenter?.machineRate ?? 0,
    name: workCenter?.name ?? "",
    overheadRate: workCenter?.overheadRate ?? 0,
    processes: workCenter?.processes ?? [],
    shifts: workCenter?.shifts ?? [],
    batchCapacity: workCenter?.batchCapacity ?? undefined,
    minimumBatchQuantity: workCenter?.minimumBatchQuantity ?? undefined,
    ...getCustomFields(workCenter?.customFields)
  };

  return (
    <WorkCenterForm
      key={initialValues.id}
      onClose={onClose}
      initialValues={initialValues}
      capitalCost={capitalCost}
    />
  );
}
