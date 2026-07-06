import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getInspectionDocument, getInspectionPlan } from "~/modules/quality";

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
  const { client, companyId } = await requirePermissions(request, {
    view: "quality"
  });

  const { id } = params;
  if (!id) {
    return data(
      { success: false, message: "Missing inspection document id" },
      { status: 400 }
    );
  }

  const documentResult = await getInspectionDocument(client, id);
  if (documentResult.error) {
    return data(
      {
        success: false,
        message: getErrorMessage(
          documentResult.error,
          "Failed to load inspection document"
        )
      },
      { status: 400 }
    );
  }
  if (!documentResult.data || documentResult.data.companyId !== companyId) {
    return data(
      { success: false, message: "Inspection document not found" },
      { status: 404 }
    );
  }

  const planResult = await getInspectionPlan(client, id);
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
