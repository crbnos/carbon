// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { manualInspectionValidator } from "~/modules/quality/quality.models";
import ManualInspectionForm from "~/modules/quality/ui/Inspections/ManualInspectionForm";
import { newRecordMeta } from "~/utils/meta";

export const meta = newRecordMeta("Inspection");

export async function loader({ request }: LoaderFunctionArgs) {
  await authorize(request, { "quality.inspections": "Create" });
  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(manualInspectionValidator).request(args);
  if ("invalid" in input) return input.invalid;

  const { itemId: _itemId, ...inspection } = input.data;
  const { api } = await authorize(args.request);
  // The drawer toasts a link to the new inspection and goes back to the list.
  return api.quality.createManualInspection(inspection);
}

export default function NewInspectionRoute() {
  const dialog = useRouteDialog();
  return (
    <ManualInspectionForm
      initialValues={{
        itemId: "",
        trackedEntityIds: [],
        inspectionDocumentId: ""
      }}
      open={dialog.open}
      onClose={dialog.close}
    />
  );
}
