// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { manualInspectionValidator } from "~/modules/quality/quality.models";
import ManualInspectionForm from "~/modules/quality/ui/Inspections/ManualInspectionForm";
import { newRecordMeta } from "~/utils/meta";
import { path } from "~/utils/path";

export const meta = newRecordMeta("Inspection");

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "quality" });
  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(manualInspectionValidator).request(args);
  if ("invalid" in input) return input.invalid;

  const { itemId: _itemId, ...inspection } = input.data;
  const api = await carbon(args.request);
  const result = await api.quality.createManualInspection(inspection);

  if (result.error) return result;
  return respond(args.request, result).redirect(
    path.to.inspection(result.data.id),
    { message: "Inspection created" }
  );
}

export default function NewInspectionRoute() {
  const closeRoute = useCloseRoute();
  return (
    <ManualInspectionForm
      initialValues={{ itemId: "", trackedEntityIds: [] }}
      onClose={() => closeRoute()}
    />
  );
}
