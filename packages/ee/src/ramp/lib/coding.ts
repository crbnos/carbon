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

/**
 * Ramp caps a `POST /accounting/field-options` batch at 500 options. Distinct
 * from `RAMP_ACCOUNTS_BATCH_SIZE` (the `POST /accounting/accounts` gl_accounts
 * cap) even though both currently sit at 500 — the field-option chunkers
 * (`cost-centers.ts`, `projects.ts`) must not be coupled to the accounts cap.
 */
export const RAMP_FIELD_OPTIONS_BATCH_SIZE = 500;

/**
 * The remote id Carbon creates the custom PROJECT field with. A second custom
 * SINGLE_CHOICE field parallel to the cost-center one, so a card holder can pick
 * a Carbon project on a transaction independently of its cost center. Its
 * options are converged in `projects.ts` (option external id = `project.id`);
 * a selection is matched inbound by this `category_info.external_id`, never by a
 * Ramp type enum (a custom field's selections come back typed `OTHER`).
 */
export const RAMP_PROJECT_FIELD_ID = "carbon-project";

/**
 * The `field_external_id` of Ramp's NATIVE GL-account field. Ramp names its
 * built-in GL account field `"Category"` (verified live 2026-09-11: a coded
 * transaction's `category_info` reads `{ type: "GL_ACCOUNT", external_id:
 * "Category" }`, and a draft-bill line written with this id read back correctly
 * coded to the account). The field is Ramp-provided, so it does NOT appear in
 * `GET /accounting/fields` (which lists only Carbon's custom cost-center field)
 * — this is the one place its id is pinned.
 */
export const RAMP_GL_ACCOUNT_FIELD_ID = "Category";

/** Ramp's native accounting-field type for a GL account selection. */
const GL_ACCOUNT = "GL_ACCOUNT";

/**
 * A Ramp accounting-field selection in WRITE shape
 * (`ApiCreateAccountingFieldParamsRequestBody`): the field's external id plus
 * the selected option's external id. Distinct from the READ shape
 * ({@link RampCodingSelection}), which nests everything under `category_info`.
 */
export type RampCodingWriteSelection = {
  field_external_id: string;
  field_option_external_id: string;
};

/**
 * Build the `accounting_field_selections` to code ONE pushed draft-bill line
 * from a Carbon purchase-invoice line's GL account and cost center. The mirror
 * of {@link codeSelections}: the GL account rides Ramp's native `"Category"`
 * field, the cost center rides Carbon's custom `"carbon-cost-center"` field,
 * and the option external id is the Carbon `account.id` / `costCenter.id`
 * (verified live — Ramp stores the pushed id as the option's external id).
 *
 * A selection is emitted ONLY when the account / cost center was actually
 * pushed to Ramp (present in `pushedAccountIds` / `pushedCostCenterIds`).
 * Coding to an unknown option would 422 the whole bill, so an unpushed account
 * degrades the line to uncoded rather than failing the push — the same
 * fail-soft stance the inbound reader takes on an unresolvable code.
 */
export function buildLineCodingSelections(
  line: {
    accountId: string | null;
    costCenterId: string | null;
    projectId: string | null;
  },
  pushed: {
    pushedAccountIds: ReadonlySet<string>;
    pushedCostCenterIds: ReadonlySet<string>;
    pushedProjectIds: ReadonlySet<string>;
  }
): RampCodingWriteSelection[] {
  const selections: RampCodingWriteSelection[] = [];
  if (line.accountId && pushed.pushedAccountIds.has(line.accountId)) {
    selections.push({
      field_external_id: RAMP_GL_ACCOUNT_FIELD_ID,
      field_option_external_id: line.accountId
    });
  }
  if (line.costCenterId && pushed.pushedCostCenterIds.has(line.costCenterId)) {
    selections.push({
      field_external_id: RAMP_COST_CENTER_FIELD_ID,
      field_option_external_id: line.costCenterId
    });
  }
  if (line.projectId && pushed.pushedProjectIds.has(line.projectId)) {
    selections.push({
      field_external_id: RAMP_PROJECT_FIELD_ID,
      field_option_external_id: line.projectId
    });
  }
  return selections;
}

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
  projectId: string | null;
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
  let projectId: string | null = null;
  for (const selection of selections ?? []) {
    if (!selection.external_id) continue;
    if (selection.category_info?.external_id === RAMP_COST_CENTER_FIELD_ID) {
      if (!costCenterId) costCenterId = selection.external_id;
      continue;
    }
    if (selection.category_info?.external_id === RAMP_PROJECT_FIELD_ID) {
      if (!projectId) projectId = selection.external_id;
      continue;
    }
    // The field TYPE is at `category_info.type` per the Ramp OpenAPI spec
    // (verified 2026-08-28); the legacy top-level `type` is only a fallback.
    const fieldType = selection.category_info?.type ?? selection.type;
    if (fieldType === GL_ACCOUNT && !accountId) {
      accountId = selection.external_id;
    }
  }
  return { accountId, costCenterId, projectId };
}
