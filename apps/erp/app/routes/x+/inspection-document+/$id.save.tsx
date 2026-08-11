import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { data } from "react-router";
import {
  saveInspectionDocumentAtomic,
  updateInspectionDocumentSampling
} from "~/modules/production";
import {
  type InspectionSaveBalloonsGeometryPayload,
  type InspectionSaveFeaturesPayload,
  mergeInspectionBalloonsPayload,
  mergeInspectionFeaturesPayload,
  resolveInspectionFeaturePayloadIds,
  translateLegacyInspectionSavePayload
} from "~/modules/production/inspectionDocumentSave.server";
import {
  inspectionDocumentSamplingValidator,
  inspectionSaveAnchorsPayloadValidator,
  inspectionSaveBalloonsGeometryPayloadValidator,
  inspectionSaveBalloonsPayloadValidator,
  inspectionSaveFeaturesPayloadValidator
} from "~/modules/production/production.models";
import { invalidateInspectionDocuments } from "~/utils/react-query";

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
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id } = params;
  if (!id)
    return data({ success: false, message: "Missing id" }, { status: 400 });

  const formData = await request.formData();
  const pdfUrl = formData.get("pdfUrl") as string | null;
  const featuresRaw = formData.get("features") as string | null;
  const balloonsRaw = formData.get("balloons") as string | null;
  const anchorsRaw = formData.get("anchors") as string | null;
  const samplingDefaultRaw = formData.get("samplingDefault") as string | null;
  const pageCountRaw = formData.get("pageCount");
  const defaultPageWidthRaw = formData.get("defaultPageWidth");
  const defaultPageHeightRaw = formData.get("defaultPageHeight");

  const pageCount =
    typeof pageCountRaw === "string" && pageCountRaw
      ? Number(pageCountRaw)
      : undefined;
  const defaultPageWidth =
    typeof defaultPageWidthRaw === "string" && defaultPageWidthRaw
      ? Number(defaultPageWidthRaw)
      : undefined;
  const defaultPageHeight =
    typeof defaultPageHeightRaw === "string" && defaultPageHeightRaw
      ? Number(defaultPageHeightRaw)
      : undefined;

  let featuresParsed = {
    create: [],
    update: [],
    delete: []
  } as InspectionSaveFeaturesPayload;
  let balloonsParsed = {
    create: [],
    update: [],
    delete: []
  } as InspectionSaveBalloonsGeometryPayload;

  if (featuresRaw) {
    try {
      const json = JSON.parse(featuresRaw) as unknown;
      const validated = inspectionSaveFeaturesPayloadValidator.safeParse(json);
      if (!validated.success) {
        throw new Error("Invalid features payload");
      }
      featuresParsed = validated.data;
    } catch {
      return data(
        { success: false, message: "Invalid features payload" },
        { status: 400 }
      );
    }
  }

  if (balloonsRaw) {
    try {
      const json = JSON.parse(balloonsRaw) as unknown;
      const geometryValidated =
        inspectionSaveBalloonsGeometryPayloadValidator.safeParse(json);
      if (geometryValidated.success) {
        balloonsParsed = geometryValidated.data;
      } else {
        const legacyValidated =
          inspectionSaveBalloonsPayloadValidator.safeParse(json);
        if (!legacyValidated.success) {
          throw new Error("Invalid balloons payload");
        }
        if (!anchorsRaw) {
          return data(
            {
              success: false,
              message: "Legacy balloons payload requires anchors"
            },
            { status: 400 }
          );
        }
        const anchorsJson = JSON.parse(anchorsRaw) as unknown;
        const anchorsValidated =
          inspectionSaveAnchorsPayloadValidator.safeParse(anchorsJson);
        if (!anchorsValidated.success) {
          throw new Error("Invalid anchors payload");
        }
        const translated = translateLegacyInspectionSavePayload(
          anchorsValidated.data,
          legacyValidated.data
        );
        featuresParsed = mergeInspectionFeaturesPayload(
          featuresParsed,
          translated.features
        );
        balloonsParsed = mergeInspectionBalloonsPayload(
          balloonsParsed,
          translated.balloons
        );
      }
    } catch {
      return data(
        { success: false, message: "Invalid balloons payload" },
        { status: 400 }
      );
    }
  } else if (anchorsRaw) {
    try {
      const anchorsJson = JSON.parse(anchorsRaw) as unknown;
      const anchorsValidated =
        inspectionSaveAnchorsPayloadValidator.safeParse(anchorsJson);
      if (!anchorsValidated.success) {
        throw new Error("Invalid anchors payload");
      }
      const translated = translateLegacyInspectionSavePayload(
        anchorsValidated.data,
        {
          create: [],
          update: [],
          delete: []
        }
      );
      featuresParsed = mergeInspectionFeaturesPayload(
        featuresParsed,
        translated.features
      );
      balloonsParsed = mergeInspectionBalloonsPayload(
        balloonsParsed,
        translated.balloons
      );
    } catch {
      return data(
        { success: false, message: "Invalid anchors payload" },
        { status: 400 }
      );
    }
  }

  featuresParsed = await resolveInspectionFeaturePayloadIds(
    client,
    id,
    featuresParsed
  );

  const rpcResult = await saveInspectionDocumentAtomic(client, {
    inspectionDocumentId: id,
    companyId,
    userId,
    pdfUrl: pdfUrl ?? undefined,
    pageCount,
    defaultPageWidth,
    defaultPageHeight,
    features: featuresParsed,
    balloons: balloonsParsed
  });

  if (rpcResult.error || !rpcResult.data) {
    return data(
      {
        success: false,
        message: getErrorMessage(
          rpcResult.error,
          "Failed to save inspection plan"
        )
      },
      { status: 400 }
    );
  }

  // The document's default sampling rule rides the same save (a single
  // UPDATE; not part of the features/balloons atomic contract).
  if (samplingDefaultRaw) {
    try {
      const json = JSON.parse(samplingDefaultRaw) as unknown;
      const validated = inspectionDocumentSamplingValidator.safeParse(json);
      if (!validated.success) {
        throw new Error("Invalid sampling payload");
      }
      const samplingResult = await updateInspectionDocumentSampling(client, {
        ...validated.data,
        inspectionDocumentId: id,
        companyId,
        userId
      });
      if (samplingResult.error) {
        return data(
          { success: false, message: "Failed to save default sampling" },
          { status: 400 }
        );
      }
    } catch {
      return data(
        { success: false, message: "Invalid sampling payload" },
        { status: 400 }
      );
    }
  }

  return rpcResult.data as {
    success: boolean;
    featureIdMap: Record<string, string>;
    balloonAnchorIdMap: Record<string, string>;
    features: unknown[];
    anchors: unknown[];
    balloons: unknown[];
  };
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  invalidateInspectionDocuments();
  return await serverAction();
}
