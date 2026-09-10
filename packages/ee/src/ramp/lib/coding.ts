/**
 * Ramp accounting-field coding — the pure half of reading a Ramp transaction,
 * bill or reimbursement line's `accounting_field_selections[]` back into Carbon
 * ids. No client, no env, browser-safe; shared by the sync job and its tests.
 *
 * Two fields matter. The GL account is Ramp's NATIVE field (selection
 * `category_info.type === "GL_ACCOUNT"`, option `external_id` = the Carbon
 * `account.id` Carbon pushed). The cost center is a CUSTOM field Carbon creates
 * (`POST /accounting/fields` with `id: "carbon-cost-center"`). A custom field
 * has no `type` at creation, so its selections come back typed `OTHER` — NOT
 * `COST_CENTER`, which is Ramp's native enum for its own cost-center concept.
 * Matching a custom field by the type enum never fires; match it by the field's
 * `category_info.external_id` (the `id` Carbon created it with) instead.
 */

/** The remote id Carbon creates the custom cost-center field with. */
export const RAMP_COST_CENTER_FIELD_ID = "carbon-cost-center";

/** Ramp's native accounting-field type for a GL account selection. */
const GL_ACCOUNT = "GL_ACCOUNT";

/** The subset of a Ramp accounting-field selection the coding reads. */
export type RampCodingSelection = {
  external_id?: string | null;
  /** Legacy top-level type — only a fallback; the spec puts it under `category_info`. */
  type?: string;
  category_info?: {
    type?: string;
    external_id?: string | null;
    id?: string | null;
  } | null;
};

export type RampCoding = {
  accountId: string | null;
  costCenterId: string | null;
};

/**
 * Resolve a coded GL account + cost center from a Ramp accounting-field
 * selection list. The first GL_ACCOUNT selection wins for the account; the
 * first selection on Carbon's custom cost-center field wins for the cost
 * center. `external_id` is the Carbon id Carbon pushed as the option
 * (account.id / costCenter.id).
 */
export function codeSelections(
  selections: ReadonlyArray<RampCodingSelection> | null | undefined
): RampCoding {
  let accountId: string | null = null;
  let costCenterId: string | null = null;
  for (const selection of selections ?? []) {
    if (!selection.external_id) continue;
    if (selection.category_info?.external_id === RAMP_COST_CENTER_FIELD_ID) {
      if (!costCenterId) costCenterId = selection.external_id;
      continue;
    }
    // The field TYPE is at `category_info.type` per the Ramp OpenAPI spec
    // (verified 2026-08-28); the legacy top-level `type` is only a fallback.
    const fieldType = selection.category_info?.type ?? selection.type;
    if (fieldType === GL_ACCOUNT && !accountId) {
      accountId = selection.external_id;
    }
  }
  return { accountId, costCenterId };
}
