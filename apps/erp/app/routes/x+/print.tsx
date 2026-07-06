import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { trigger } from "@carbon/jobs";
import { manualPrintValidator } from "@carbon/printing";
import type { ActionFunctionArgs } from "react-router";

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
