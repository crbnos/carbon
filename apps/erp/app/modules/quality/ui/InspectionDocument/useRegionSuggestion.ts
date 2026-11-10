// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { BalloonRegionAnalysis } from "~/modules/quality/quality.models";
import { path } from "~/utils/path";
import { cropInspectionAnchorToPngBlob } from "./drawingRaster";
import {
  applyRegionAnalysis,
  blobToBase64Data,
  type FeatureRow,
  type PctRect,
  readPdfBytes
} from "./editorModel";

type UseRegionSuggestionArgs = {
  diagramId: string;
  pdfFile: File | null;
  pdfUrl: string;
  /** The page's width on screen, which the crop is rendered at. */
  renderedPageWidthPx: number;
  setFeatureRows: Dispatch<SetStateAction<FeatureRow[]>>;
};

/**
 * The region under a new selector, cropped from the drawing and analysed,
 * fills in the new characteristic's values (nominal, tolerances, unit).
 */
export function useRegionSuggestion({
  diagramId,
  pdfFile,
  pdfUrl,
  renderedPageWidthPx,
  setFeatureRows
}: UseRegionSuggestionArgs) {
  const { t } = useLingui();
  return useCallback(
    async (balloonId: string, region: PctRect & { pageNumber: number }) => {
      try {
        if (pdfFile === null && !pdfUrl) {
          return;
        }
        const bytes = await readPdfBytes(pdfFile, pdfUrl);
        const blob = await cropInspectionAnchorToPngBlob({
          pdfBytes: bytes,
          pageNumber: region.pageNumber,
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
          renderedPageWidthPx
        });

        try {
          const imageBase64 = await blobToBase64Data(blob);
          const analyzeRes = await fetch(
            path.to.api.inspectionDocumentBalloonAnalyze(diagramId),
            {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                imageBase64,
                mediaType: "image/png"
              })
            }
          );
          const payloadUnknown: unknown = await analyzeRes.json();
          const payload = payloadUnknown as {
            success?: boolean;
            analysis?: BalloonRegionAnalysis;
            message?: string;
          };
          if (!analyzeRes.ok || !payload.success || !payload.analysis) {
            toast.error(
              t`Could not analyze region: ${payload.message ?? analyzeRes.statusText}`
            );
            return;
          }
          const a = payload.analysis;
          setFeatureRows((prev) =>
            prev.map((r) =>
              r.balloonId !== balloonId ? r : applyRegionAnalysis(r, a)
            )
          );
          toast.success(t`Characteristic values suggested from drawing`);
        } catch {
          toast.error(t`Could not analyze cropped region`);
        }
      } catch {
        toast.error(t`Could not prepare region image for analysis`);
      }
    },
    [pdfFile, pdfUrl, renderedPageWidthPx, diagramId, setFeatureRows, t]
  );
}
