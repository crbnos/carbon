// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { manualPrintValidator } from "@carbon/printing";
import type { ActionFunctionArgs } from "react-router";
import { printLabel } from "~/services/commands.steps.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});

  const json = await request.json();
  const validation = manualPrintValidator.safeParse(json);

  if (!validation.success) {
    return { success: false, message: "Invalid print request" };
  }

  const {
    sourceDocument,
    sourceDocumentId,
    locationId,
    workCenterId,
    printerRouteId
  } = validation.data;

  // The web form carries the location in its body; the API reads it from
  // `x-carbon-location`, so the command takes it as an argument either way.
  const result = await printLabel(
    { companyId, userId, locationId },
    { sourceDocument, sourceDocumentId, workCenterId, printerRouteId }
  );

  if (!result.ok) {
    return { success: false, message: result.failure.message };
  }

  return { success: true, message: "Print job queued" };
}
