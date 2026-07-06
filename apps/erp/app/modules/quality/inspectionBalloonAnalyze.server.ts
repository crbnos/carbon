import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import {
  type BalloonRegionAnalysis,
  balloonRegionAnalysisResultSchema
} from "./inspectionBalloonAnalyze";

/** Decoded image size limit for vision analyze (bytes). */
export const INSPECTION_BALLOON_ANALYZE_MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const BALLOON_REGION_ANALYSIS_SYSTEM = `You assist with mechanical inspection ballooning on technical CAD drawings.

You receive one raster image: a crop of a single callout region from a sheet.

Return ONLY the JSON object matching the schema (field names and allowed enum values exactly).

type (required, exactly one of):
- linear — linear length/width/height dimension without ⌀ or R prefix.
- diameter — nominal is the value for a diameter callout (⌀ or equivalent).
- radius — nominal is the value for a radius callout (R or equivalent).
- angle — nominal is the numeric angle; set unit to degree or rad only when °, deg, or rad is visible in the crop; otherwise unit null.
- unknown — not clearly one of the above, or unreadable / ambiguous.

unit (nullable, exactly one of the allowed enum strings or null):
- Default is null. Set unit ONLY when this crop visibly shows a unit indicator (e.g. mm, cm, m, um, µm, in, ", IN, ft, °, DEG, RAD, or equivalent text/symbols next to the dimension).
- Do NOT infer unit from decimal places, title block, drawing "standard," locale, or anything outside visible pixels in this crop. A bare number with tolerances but no unit text/symbol → unit null.
- For type angle: use degree or rad only when that angle notation is visible; otherwise unit null.

nominal / tolerances:
- Prefer numbers from the print; use null (not zero) when not shown or unreadable.
- Bilateral ±T: tol_plus = +T, tol_minus = -T (e.g. ±0.02 → tol_plus 0.02, tol_minus -0.02).
- Unilateral stacked +0.005 / -0.000 (plus above, minus below nominal): tol_plus = 0.005, tol_minus = 0 (minus side is zero additional tolerance below nominal).
- Other asymmetric +a / −b (both non-zero): tol_plus = +a, tol_minus = -b using the signed values as printed relative to nominal.

Do not invent title-block or revision data outside the crop.
`;

const BALLOON_REGION_ANALYSIS_USER_MESSAGE =
  "Extract nominal, tol_plus, tol_minus, unit, and type per the system rules. For unit: use null unless a unit symbol or unit letters are literally visible in this crop; do not guess. Use only allowed enum literals for type and for unit when non-null.";

const BALLOON_REGION_ANALYSIS_SCHEMA_DESCRIPTION =
  "Drawing crop: nominal, tolerances, type enum; unit enum only when a unit symbol/text is visible in the crop, otherwise null";

/**
 * Runs vision extraction on a prepared PNG/JPEG/WebP buffer (caller validates size and auth).
 */
export async function runInspectionBalloonRegionVisionAnalysis(args: {
  imageBytes: Buffer;
  mediaType: string;
}): Promise<BalloonRegionAnalysis> {
  const { imageBytes, mediaType } = args;
  const { object } = await generateObject({
    model: openai("gpt-4o"),
    schema: balloonRegionAnalysisResultSchema,
    schemaName: "balloon_region_analysis",
    schemaDescription: BALLOON_REGION_ANALYSIS_SCHEMA_DESCRIPTION,
    system: BALLOON_REGION_ANALYSIS_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: BALLOON_REGION_ANALYSIS_USER_MESSAGE },
          {
            type: "image",
            image: imageBytes,
            mediaType
          }
        ]
      }
    ],
    temperature: 0.1
  });
  return object;
}
