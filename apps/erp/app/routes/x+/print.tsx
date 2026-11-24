// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { anyOf } from "@carbon/database/access";
import { trigger } from "@carbon/jobs";
import { getPrintPermissions, manualPrintValidator } from "@carbon/printing";
import type { ActionFunctionArgs } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const json = await request.json();
  const validation = manualPrintValidator.safeParse(json);

  if (!validation.success) {
    await authorize(request);
    return { success: false, message: "Invalid print request" };
  }

  // The task reads as the service role: check the document's own module.
  const view = getPrintPermissions(validation.data.sourceDocument);
  const { companyId, userId } = await authorize(
    request,
    view.length > 0 ? anyOf(view, "View") : {}
  );

  const {
    sourceDocument,
    sourceDocumentId,
    locationId,
    workCenterId,
    printerRouteId
  } = validation.data;

  try {
    await trigger("print-job", {
      sourceDocument,
      sourceDocumentId,
      companyId,
      userId,
      locationId,
      workCenterId,
      printerRouteId
    });
    return { success: true, message: "Print job queued" };
  } catch (e) {
    return {
      success: false,
      message: e instanceof Error ? e.message : "Failed to queue print job"
    };
  }
}
