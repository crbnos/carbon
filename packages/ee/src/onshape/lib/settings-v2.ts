// Onshape v2's settings, read from its OWN integration record.
//
// Before the split, "is this company on v2?" was a question about a key inside
// the shipped `onshape` record's metadata (`pipeline === "next"`). It is now a
// question about which record exists: an active `onshape-v2` row IS the opt-in.
// There is no pipeline field, no strict-equality ceremony, and no way for a
// legacy-shaped row to be mistaken for a v2 one — the two are different rows.
//
// The gate still fails CLOSED. A missing row, an inactive one, or a query error
// all resolve to `active: false`, because failing open would run v2 against a
// company that never installed it.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ONSHAPE_V2_INTEGRATION_ID } from "./ids";

/** What v2 does with the engineering data in an Onshape release. */
export type OnshapeReleaseImportV2Mode = "off" | "changeNotice" | "revision";

export interface OnshapeV2Settings {
  /** The `onshape-v2` record exists and is active — i.e. the company is on v2. */
  active: boolean;
  attachAssetsOnRelease: boolean;
  releaseImportV2: OnshapeReleaseImportV2Mode;
  allowUnreleasedSync: boolean;
  /**
   * Create the Carbon part when a release names an element nothing is linked to.
   *
   * OFF by default. A release carries geometry, not structure, and it cannot
   * tell Carbon whether the part is bought or made — so turning this on accepts
   * that Carbon will GUESS those fields, and say so in the run's report.
   */
  createItemsOnRelease: boolean;
  /** Cached Onshape tenant id, when this record's connection has resolved one. */
  onshapeCompanyId: string | null;
  /**
   * The row could not be READ (query error), as opposed to being absent or
   * inactive. A caller that is about to WRITE must treat this as retryable
   * rather than as "this company is not on v2" — a transient database error
   * would otherwise turn a real import into a silent no-op run.
   */
  readFailed: boolean;
}

const DEFAULTS: Omit<
  OnshapeV2Settings,
  "active" | "onshapeCompanyId" | "readFailed"
> = {
  attachAssetsOnRelease: true,
  releaseImportV2: "changeNotice",
  allowUnreleasedSync: false,
  // FALSE, not true. Copying attachAssetsOnRelease's "absent means on" reading
  // would start minting parts for every v2 install on deploy, unasked.
  createItemsOnRelease: false
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
 * Parse v2 settings out of an `onshape-v2` row's metadata blob. Pure, so it can
 * be unit-tested without a database.
 */
export function parseOnshapeV2Settings(
  metadata: unknown,
  options: { active: boolean; readFailed?: boolean }
): OnshapeV2Settings {
  const record =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : {};

  const rawMode = record.releaseImportV2;
  const releaseImportV2: OnshapeReleaseImportV2Mode =
    rawMode === "off" || rawMode === "revision" || rawMode === "changeNotice"
      ? rawMode
      : DEFAULTS.releaseImportV2;

  return {
    active: options.active,
    readFailed: options.readFailed === true,
    attachAssetsOnRelease: readBoolean(
      record.attachAssetsOnRelease,
      DEFAULTS.attachAssetsOnRelease
    ),
    releaseImportV2,
    allowUnreleasedSync: readBoolean(
      record.allowUnreleasedSync,
      DEFAULTS.allowUnreleasedSync
    ),
    createItemsOnRelease: readBoolean(
      record.createItemsOnRelease,
      DEFAULTS.createItemsOnRelease
    ),
    onshapeCompanyId:
      typeof record.onshapeCompanyId === "string" && record.onshapeCompanyId
        ? record.onshapeCompanyId
        : null
  };
}

/** Read a company's Onshape v2 settings from the `onshape-v2` record. */
export async function getOnshapeV2Settings(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<OnshapeV2Settings> {
  const integration = await client
    .from("companyIntegration")
    .select("active, metadata")
    .eq("id", ONSHAPE_V2_INTEGRATION_ID)
    .eq("companyId", companyId)
    .maybeSingle();

  if (integration.error) {
    // Distinct from "no row": the gate still fails closed, but a caller that is
    // about to WRITE can tell a transient failure from a deliberate opt-out.
    return parseOnshapeV2Settings(null, { active: false, readFailed: true });
  }
  if (!integration.data) {
    return parseOnshapeV2Settings(null, { active: false });
  }

  return parseOnshapeV2Settings(integration.data.metadata, {
    active: integration.data.active === true
  });
}

/**
 * Does this company want an Onshape webhook subscription for v2?
 *
 * ONE subscription feeds every v2 consumer, so it must exist while ANY of them
 * is on and be deregistered only when they are all off. `createItemsOnRelease`
 * is not optional here: omitting it deletes the subscription of a company that
 * turned auto-create on and everything else off, while flashing success.
 */
export function v2WebhookWanted(settings: OnshapeV2Settings): boolean {
  return (
    settings.attachAssetsOnRelease ||
    settings.releaseImportV2 !== "off" ||
    settings.createItemsOnRelease
  );
}

/**
 * Does this company want one for the LEGACY record? Reads the legacy metadata
 * shape directly — the two records' settings have nothing in common beyond the
 * fact that each drives one subscription.
 */
export function legacyWebhookWanted(metadata: unknown): boolean {
  const record =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : {};
  return (
    record.assetSyncEnabled === true || record.releaseImportEnabled === true
  );
}

/**
 * The v2 settings form's validator, and what the save merges over the stored
 * metadata.
 *
 * Lives here rather than in the config file so it can be exercised without the
 * auth env that file pulls in through `ONSHAPE_CLIENT_ID`.
 *
 * Every key is `.optional()` rather than `.default()`. A hidden or unmounted
 * field posts NOTHING, and the save merges parsed values over what is stored —
 * so a default would rewrite a stored setting on any save that did not render
 * the field. Absence means "leave it alone"; the parser above supplies the
 * defaults on read, which is the only place they belong.
 */
export const onshapeV2SettingsSchema = z.object({
  // SwitchField posts a literal "true"/"false" string; preprocess explicitly so
  // unchecking sticks (z.coerce.boolean would treat "false" as truthy).
  attachAssetsOnRelease: z
    .preprocess((value) => {
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      return value;
    }, z.boolean())
    .optional(),
  releaseImportV2: z.enum(["off", "changeNotice", "revision"]).optional(),
  allowUnreleasedSync: z
    .preprocess((value) => {
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      return value;
    }, z.boolean())
    .optional(),
  createItemsOnRelease: z
    .preprocess((value) => {
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      return value;
    }, z.boolean())
    .optional(),
  // Vaulted (SECRET_KEYS["onshape-v2"]), so it never reaches the metadata
  // column and the field always renders blank. An empty submission means "keep
  // the stored key" — splitSecrets drops an empty value rather than persisting
  // it — which is why this must stay optional and undefaulted.
  webhookSigningSecret: z.string().optional()
});
