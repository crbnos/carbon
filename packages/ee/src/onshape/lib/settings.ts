// The Onshape integration's settings.
//
// There is ONE Onshape integration. "Is this company on Onshape?" is simply
// whether an active `onshape` row exists — no pipeline field, no mode key, and
// no second record to disambiguate against.
//
// The gate fails CLOSED. A missing row, an inactive one, or a query error all
// resolve to `active: false`, because failing open would run an import against a
// company that never connected.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/** What Carbon does with the engineering data in an Onshape release. */
export type OnshapeReleaseImportMode = "off" | "changeNotice" | "revision";

export interface OnshapeSettings {
  /** The `onshape` record exists and is active — i.e. the company is connected. */
  active: boolean;
  attachAssetsOnRelease: boolean;
  releaseImportMode: OnshapeReleaseImportMode;
  /**
   * Create the Carbon part when a release names an element nothing is linked to.
   *
   * OFF by default. A release carries geometry, not structure, and it cannot
   * tell Carbon whether the part is bought or made — so turning this on accepts
   * that Carbon will GUESS those fields, and say so in the run's report.
   */
  createItemsOnRelease: boolean;
  /** Cached Onshape tenant id, when the connection has resolved one. */
  onshapeCompanyId: string | null;
  /**
   * The row could not be READ (query error), as opposed to being absent or
   * inactive. A caller that is about to WRITE must treat this as retryable
   * rather than as "this company is not connected" — a transient database error
   * would otherwise turn a real import into a silent no-op run.
   */
  readFailed: boolean;
}

const DEFAULTS: Omit<
  OnshapeSettings,
  "active" | "onshapeCompanyId" | "readFailed"
> = {
  attachAssetsOnRelease: true,
  releaseImportMode: "changeNotice",
  // FALSE, not true. Copying attachAssetsOnRelease's "absent means on" reading
  // would start minting parts for every existing install on deploy, unasked.
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
 * Parse the settings out of an `onshape` row's metadata blob. Pure, so it can be
 * unit-tested without a database.
 */
export function parseOnshapeSettings(
  metadata: unknown,
  options: { active: boolean; readFailed?: boolean }
): OnshapeSettings {
  const record =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : {};

  const rawMode = record.releaseImportMode;
  const releaseImportMode: OnshapeReleaseImportMode =
    rawMode === "off" || rawMode === "revision" || rawMode === "changeNotice"
      ? rawMode
      : DEFAULTS.releaseImportMode;

  return {
    active: options.active,
    readFailed: options.readFailed === true,
    attachAssetsOnRelease: readBoolean(
      record.attachAssetsOnRelease,
      DEFAULTS.attachAssetsOnRelease
    ),
    releaseImportMode,
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

/** Read a company's Onshape settings. */
export async function getOnshapeSettings(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<OnshapeSettings> {
  const integration = await client
    .from("companyIntegration")
    .select("active, metadata")
    .eq("id", "onshape")
    .eq("companyId", companyId)
    .maybeSingle();

  if (integration.error) {
    // Distinct from "no row": the gate still fails closed, but a caller that is
    // about to WRITE can tell a transient failure from a deliberate opt-out.
    return parseOnshapeSettings(null, { active: false, readFailed: true });
  }
  if (!integration.data) {
    return parseOnshapeSettings(null, { active: false });
  }

  return parseOnshapeSettings(integration.data.metadata, {
    active: integration.data.active === true
  });
}

/**
 * Does this company want an Onshape webhook subscription?
 *
 * ONE subscription feeds every consumer, so it must exist while ANY of them
 * is on and be deregistered only when they are all off. `createItemsOnRelease`
 * is not optional here: omitting it deletes the subscription of a company that
 * turned auto-create on and everything else off, while flashing success.
 */
export function onshapeWebhookWanted(settings: OnshapeSettings): boolean {
  return (
    settings.attachAssetsOnRelease ||
    settings.releaseImportMode !== "off" ||
    settings.createItemsOnRelease
  );
}

/**
 * The settings form's validator, and what the save merges over the stored
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
export const onshapeSettingsSchema = z.object({
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
  releaseImportMode: z.enum(["off", "changeNotice", "revision"]).optional(),
  createItemsOnRelease: z
    .preprocess((value) => {
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      return value;
    }, z.boolean())
    .optional(),
  // Vaulted (SECRET_KEYS["onshape"]), so it never reaches the metadata
  // column and the field always renders blank. An empty submission means "keep
  // the stored key" — splitSecrets drops an empty value rather than persisting
  // it — which is why this must stay optional and undefaulted.
  webhookSigningSecret: z.string().optional()
});
