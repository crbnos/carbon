// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId, api } = await authorize(request, {
    "quality.inspectionPlans": "View"
  });

  const { id } = params;
  if (!id) {
    return data(
      { success: false, message: "Missing inspection plan id" },
      { status: 400 }
    );
  }

  const documentResult = await api.quality.getInspectionDocument({ id });
  if (documentResult.error) {
    return data(
      {
        success: false,
        message: getErrorMessage(
          documentResult.error,
          "Failed to load inspection plan"
        )
      },
      { status: 400 }
    );
  }
  if (!documentResult.data || documentResult.data.companyId !== companyId) {
    return data(
      { success: false, message: "Inspection plan not found" },
      { status: 404 }
    );
  }

  const planResult = await api.quality.getInspectionPlan({
    inspectionDocumentId: id
  });
  if (planResult.error) {
    return data(
      {
        success: false,
        message: getErrorMessage(
          planResult.error,
          "Failed to load inspection plan"
        )
      },
      { status: 400 }
    );
  }

  return data({
    success: true,
    documentId: id,
    itemId: documentResult.data.partId ?? null,
    drawingNumber: documentResult.data.content?.drawingNumber ?? null,
    /** Each row: `id` / `featureId` = inspectionFeature id; `balloonId` = balloon when placed. */
    measurements: planResult.data ?? []
  });
}
