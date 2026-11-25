// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { parseSortOrderUpdates } from "~/modules/shared/sort-order";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { api } = await authorize(request);

  const formData = await request.formData();
  const stepId = formData.get("stepId");
  const updates = parseSortOrderUpdates(formData);
  if (typeof stepId !== "string" || !updates) {
    return data(
      { success: false },
      await flash(request, error(null, "Failed to receive a new slide order"))
    );
  }

  const result = await api.items.updateMethodOperationStepSlideOrder({
    stepId,
    updates
  });
  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to reorder slides"))
    );
  }

  return { success: true };
}
