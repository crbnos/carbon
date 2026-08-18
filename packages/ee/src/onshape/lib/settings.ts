// Resolving which Onshape pipeline a company runs, and the v2 settings.
//
// v2 ships ALONGSIDE the legacy integration on one OAuth connection and one
// webhook subscription, so every v2 entry point has to ask "is this company on
// v2?" before doing anything. Exactly one pipeline runs at a time: running both
// against one Onshape company would duplicate change notices, collide on
// item_unique in revision mode, and double every export call.
//
// The critical property: NO existing companyIntegration row has a `pipeline`
// key, and every read here tests `=== "next"` strictly. So an absent key means
// legacy BY CONSTRUCTION rather than by falling through to a default value —
// which is what makes shipping v2 alongside safe for existing installs.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export type OnshapePipeline = "legacy" | "next";

/** What the v2 pipeline does when Onshape reports a released revision. */
export type OnshapeReleaseImportV2Mode = "off" | "changeNotice" | "revision";

export interface OnshapeV2Settings {
  /** The integration row exists and is active. */
  active: boolean;
  pipeline: OnshapePipeline;
  /** True only when the integration is active AND the company is on v2. */
  isV2: boolean;
  attachAssetsOnRelease: boolean;
  releaseImportV2: OnshapeReleaseImportV2Mode;
  allowUnreleasedSync: boolean;
  /** Cached Onshape tenant id, when the connection has resolved one. */
  onshapeCompanyId: string | null;
}

const DEFAULTS: Omit<
  OnshapeV2Settings,
  "active" | "isV2" | "onshapeCompanyId"
> = {
  pipeline: "legacy",
  attachAssetsOnRelease: true,
  releaseImportV2: "changeNotice",
  allowUnreleasedSync: false
};

// The settings form posts "true"/"false" as strings and zod coerces them before
// storage, but a hand-edited row (or a key written by an older build) can hold
// either shape. Accept both and treat anything else as the default rather than
// as truthy — an unrecognised value must never silently enable a behaviour.
function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/**
 * Parse v2 settings out of a `companyIntegration.metadata` blob.
 *
 * Pure, so the pipeline decision can be unit-tested without a database — the
 * whole safety argument for shipping alongside rests on this returning
 * `isV2: false` for every legacy-shaped row.
 */
export function parseOnshapeV2Settings(
  metadata: unknown,
  options: { active: boolean }
): OnshapeV2Settings {
  const record =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : {};

  // Strict equality against the NEW value. An absent key, a null, a legacy
  // row, or a typo all resolve to legacy.
  const pipeline: OnshapePipeline =
    record.pipeline === "next" ? "next" : "legacy";

  const rawMode = record.releaseImportV2;
  const releaseImportV2: OnshapeReleaseImportV2Mode =
    rawMode === "off" || rawMode === "revision" || rawMode === "changeNotice"
      ? rawMode
      : DEFAULTS.releaseImportV2;

  return {
    active: options.active,
    pipeline,
    isV2: options.active && pipeline === "next",
    attachAssetsOnRelease: readBoolean(
      record.attachAssetsOnRelease,
      DEFAULTS.attachAssetsOnRelease
    ),
    releaseImportV2,
    allowUnreleasedSync: readBoolean(
      record.allowUnreleasedSync,
      DEFAULTS.allowUnreleasedSync
    ),
    onshapeCompanyId:
      typeof record.onshapeCompanyId === "string" && record.onshapeCompanyId
        ? record.onshapeCompanyId
        : null
  };
}

/**
 * Read a company's Onshape v2 settings.
 *
 * A missing row, an inactive integration, or a query error all resolve to
 * `isV2: false` — this gate must fail CLOSED, since failing open would run the
 * v2 pipeline on a company that never opted into it.
 */
export async function getOnshapeV2Settings(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<OnshapeV2Settings> {
  const integration = await client
    .from("companyIntegration")
    .select("active, metadata")
    .eq("id", "onshape")
    .eq("companyId", companyId)
    .maybeSingle();

  if (integration.error || !integration.data) {
    return parseOnshapeV2Settings(null, { active: false });
  }

  return parseOnshapeV2Settings(integration.data.metadata, {
    active: integration.data.active === true
  });
}
