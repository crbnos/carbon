import { z } from "zod";

/**
 * POST `/api/quality/inspection-document/:inspectionDocumentId/balloon-analyze` — request body
 * uses `balloonRegionAnalysisRequestSchema`. Successful JSON body includes `analysis`
 * matching `balloonRegionAnalysisResultSchema`:
 *
 * - `nominal`, `tol_plus`, `tol_minus`: number or `null` (no free-text dimensions).
 * - `type`: always one of `balloonRegionFeatureTypes` (use `unknown` when not classifiable).
 * - `unit`: one of `balloonRegionUnits` only when a unit symbol/text is visible in the crop;
 *   otherwise `null` (clients must not assume a default unit).
 *
 * Breaking change vs legacy: `type` and `unit` are closed vocabularies, not arbitrary strings.
 *
 * Server-only vision + prompts: `inspectionBalloonAnalyze.server.ts` (not exported from `index.ts`).
 */

/** POST body for `/api/quality/inspection-document/:id/balloon-analyze` */
export const balloonRegionAnalysisRequestSchema = z.object({
  /** Base64-encoded image bytes (no `data:` prefix). */
  imageBase64: z.string().min(1).max(28_000_000),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]).optional()
});

/** Allowed `type` values for vision extraction (strict contract). */
export const balloonRegionFeatureTypes = [
  "linear",
  "diameter",
  "radius",
  "angle",
  "unknown"
] as const;

/** Allowed `unit` literals when a unit is visibly present in the crop; otherwise API returns `null`. */
export const balloonRegionUnits = [
  "mm",
  "cm",
  "m",
  "in",
  "ft",
  "um",
  "degree",
  "rad"
] as const;

export type BalloonRegionFeatureType =
  (typeof balloonRegionFeatureTypes)[number];
export type BalloonRegionUnit = (typeof balloonRegionUnits)[number];

/** Structured extraction from a cropped engineering-drawing region. */
export const balloonRegionAnalysisResultSchema = z.object({
  nominal: z
    .number()
    .nullable()
    .describe(
      "Primary scalar from the dimension (length, diameter, radius, or angle magnitude). Null if unreadable."
    ),
  tol_plus: z
    .number()
    .nullable()
    .describe(
      "Upper tolerance vs nominal: bilateral ±T → +T; unilateral +a / −b → +a as printed (e.g. +0.005 → 0.005)."
    ),
  tol_minus: z
    .number()
    .nullable()
    .describe(
      "Lower tolerance vs nominal: bilateral ±T → −T (e.g. −0.02); unilateral +0.005 / −0.000 → 0 for a −.000 stack (no extra material below nominal on minus side)."
    ),
  unit: z
    .enum(balloonRegionUnits)
    .nullable()
    .describe(
      'Allowed enum or null. Null unless unit text/symbol is visible in the crop (e.g. mm, in, ", °). Never infer from decimals or title block. For angles: degree or rad only when that notation appears; else null.'
    ),
  type: z
    .enum(balloonRegionFeatureTypes)
    .describe(
      "Feature kind: linear, diameter, radius, angle, or unknown when ambiguous or not a simple dimension."
    )
});

export type BalloonRegionAnalysis = z.infer<
  typeof balloonRegionAnalysisResultSchema
>;
