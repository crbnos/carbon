import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RAMP_COST_CENTER_FIELD_ID } from "./coding";
import {
  buildFieldBody,
  buildFieldOptionsBody,
  type CustomSingleChoiceFieldSpec,
  diffFieldOptions,
  ensureCustomFieldDimension,
  fieldFingerprint,
  pushCustomSingleChoiceField,
  type RampFieldMapping,
  type RampFieldOption,
  type RampRemoteFieldOption
} from "./custom-single-choice-field";

// /********************************************************\
// *        Cost centers — the custom "project" field        *
// \********************************************************/

/** The Carbon cost center as a Ramp option: `id` = costCenter.id, `value` = name. */
export type RampCostCenterOption = RampFieldOption;

/** A `costCenter` mapping row: Carbon id ↔ Ramp option UUID + last-pushed fingerprint. */
export type RampCostCenterMapping = RampFieldMapping;

/** The subset of a Ramp field option the converge reads back. */
export type { RampRemoteFieldOption };

/** What Carbon last pushed for an option: its label and whether it is selectable. */
export function costCenterFingerprint(option: {
  value: string;
  visible: boolean;
}): string {
  return fieldFingerprint(option);
}

/**
 * `POST /accounting/fields` body. Ramp keys a custom field by `id` — the
 * "remote/external ID … from the ERP system" — and assigns its own `ramp_id`
 * UUID, which is what the field-OPTIONS endpoints want in `field_id`. (The old
 * push sent `external_id` here and then passed this string id as `field_id`,
 * which is the "Not a valid UUID" 422 it recorded.) `display_name` is the label
 * card holders see; it is set from the same name so nobody has to rename it.
 */
export function buildCostCenterFieldBody(name: string) {
  return buildFieldBody(RAMP_COST_CENTER_FIELD_ID, name);
}

/** `POST /accounting/field-options` body: option `id` is the Carbon costCenter.id. */
export function buildCostCenterOptionsBody(
  fieldRampId: string,
  options: RampCostCenterOption[]
) {
  return buildFieldOptionsBody(fieldRampId, options);
}

/**
 * Pure diff of Carbon's cost centers against the options Ramp already holds
 * (existence + `ramp_id` come from the remote listing) and against what Carbon
 * last pushed (the mapping fingerprint decides whether a rename or a visibility
 * change is Carbon's to make). A Ramp-side manual edit therefore survives until
 * the Carbon side changes. A cost center gone from Carbon is HIDDEN, never
 * deleted — the option may still be on synced transactions.
 */
export function diffCostCenterOptions(
  desired: RampCostCenterOption[],
  remote: RampRemoteFieldOption[],
  mappings: RampCostCenterMapping[]
): {
  toCreate: RampCostCenterOption[];
  toRename: Array<{ option: RampCostCenterOption; rampId: string }>;
  toShow: Array<{ option: RampCostCenterOption; rampId: string }>;
  toHide: Array<{ id: string; value: string; rampId: string }>;
} {
  return diffFieldOptions(desired, remote, mappings);
}

/** The parameters that specialise the shared converge for cost centers. */
const COST_CENTER_SPEC: CustomSingleChoiceFieldSpec = {
  fieldId: RAMP_COST_CENTER_FIELD_ID,
  optionEntityType: "costCenter",
  fieldEntityType: "costCenterField",
  dimensionEntityType: "CostCenter",
  dimensionName: "Cost Center",
  messages: {
    loadMappings: "Failed to load Ramp cost-center mappings",
    recordMappings: "Failed to record Ramp cost-center mappings",
    loadDimension: "Failed to load the Cost Center dimension",
    createDimension: "Failed to create the Cost Center dimension",
    missingFieldRampId:
      "Ramp did not return a ramp_id for the cost-center field",
    loadFieldMapping: "Failed to load the Ramp field mapping",
    recordFieldMapping: "Failed to record the Ramp field mapping"
  },
  loadDesiredOptions: async (serviceRole, companyId) => {
    const { data: costCenters, error } = await serviceRole
      .from("costCenter")
      .select("id, name")
      .eq("companyId", companyId);
    if (error) {
      throw new Error(`Failed to load cost centers: ${error.message}`);
    }
    return (costCenters ?? []).map((row) => ({
      id: row.id,
      value: row.name
    }));
  }
};

/**
 * The company group's active `CostCenter` dimension — created if missing. The
 * posting function writes every card line's cost center as a
 * `journalLineDimension` against this row, so without it the tag is dropped at
 * posting time; and its `name` is what the customer calls the concept, so it
 * names the Ramp field (and, already, the Rillet Field). `dimension` is
 * companyGroup-scoped.
 */
export async function ensureCostCenterDimension(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<{ id: string; name: string }> {
  return ensureCustomFieldDimension(serviceRole, companyId, COST_CENTER_SPEC);
}

/**
 * Converge Carbon's cost centers into Ramp as the options of one custom
 * single-choice field (the "project" a card holder picks), as a true diff:
 * create new, rename changed, hide removed, re-show restored — tracked per
 * cost center in `externalIntegrationMapping` (entityType `costCenter`). Runs
 * on install / settings save and on every `ramp-sync`, so a cost center added
 * in Carbon reaches Ramp within ≤1h. An unchanged set is a cheap no-op.
 *
 * `POST /accounting/field-options` is all-or-nothing and rejects options that
 * already exist, which is why the diff is driven off the remote listing rather
 * than a blind re-post.
 */
export async function pushCostCenters(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<{
  created: number;
  renamed: number;
  hidden: number;
  shown: number;
  pushed: number;
}> {
  return pushCustomSingleChoiceField(serviceRole, companyId, COST_CENTER_SPEC);
}
