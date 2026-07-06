import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { balloonRegionAnalysisRequestSchema } from "~/modules/quality/inspectionBalloonAnalyze";
import {
  INSPECTION_BALLOON_ANALYZE_MAX_IMAGE_BYTES,
  runInspectionBalloonRegionVisionAnalysis
} from "~/modules/quality/inspectionBalloonAnalyze.server";
import { getInspectionDocument } from "~/modules/quality/quality.service";

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

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { client, companyId } = await requirePermissions(request, {
    update: "quality"
  });

  const inspectionDocumentId = params.inspectionDocumentId;
  if (!inspectionDocumentId) {
    return data(
      { success: false as const, message: "Missing inspection document id" },
      { status: 400 }
    );
  }

  const docResult = await getInspectionDocument(client, inspectionDocumentId);
  if (docResult.error || !docResult.data) {
    return data(
      {
        success: false as const,
        message: getErrorMessage(
          docResult.error,
          "Inspection document not found"
        )
      },
      { status: 404 }
    );
  }
  if (docResult.data.companyId !== companyId) {
    return data(
      { success: false as const, message: "Inspection document not found" },
      { status: 404 }
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return data(
      { success: false as const, message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = balloonRegionAnalysisRequestSchema.safeParse(json);
  if (!parsed.success) {
    return data(
      {
        success: false as const,
        message: "Invalid request",
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const { imageBase64, mediaType } = parsed.data;
  let imageBytes: Buffer;
  try {
    imageBytes = Buffer.from(imageBase64, "base64");
  } catch {
    return data(
      { success: false as const, message: "Invalid base64 image" },
      { status: 400 }
    );
  }

  if (imageBytes.length === 0) {
    return data(
      { success: false as const, message: "Empty image" },
      { status: 400 }
    );
  }
  if (imageBytes.length > INSPECTION_BALLOON_ANALYZE_MAX_IMAGE_BYTES) {
    return data(
      { success: false as const, message: "Image too large" },
      { status: 413 }
    );
  }

  const mime = mediaType ?? "image/png";

  try {
    const object = await runInspectionBalloonRegionVisionAnalysis({
      imageBytes,
      mediaType: mime
    });

    return data({ success: true as const, analysis: object });
  } catch (error) {
    const message = getErrorMessage(error, "Analysis failed");
    return data(
      {
        success: false as const,
        message
      },
      { status: 502 }
    );
  }
}
