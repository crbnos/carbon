// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { trigger } from "@carbon/jobs";
import { manualPrintValidator } from "@carbon/printing";
import type { ActionFunctionArgs } from "react-router";

// The print task reads as the service role, so a document that is not a label
// needs its own module's view permission before it can be printed.
const sourceDocumentPermissions: Record<string, string> = {
  PackingSlip: "inventory",
  SalesInvoice: "invoicing"
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const json = await request.json();
  const validation = manualPrintValidator.safeParse(json);

  if (!validation.success) {
    await requirePermissions(request, {});
    return { success: false, message: "Invalid print request" };
  }

  const view = sourceDocumentPermissions[validation.data.sourceDocument];
  const { companyId, userId } = await requirePermissions(
    request,
    view ? { view } : {}
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
