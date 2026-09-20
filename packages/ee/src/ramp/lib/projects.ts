import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RAMP_PROJECT_FIELD_ID } from "./coding";
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
// *        Projects — the custom "project" field           *
// \********************************************************/

/** The Carbon project as a Ramp option: `id` = project.id, `value` = name. */
export type RampProjectOption = RampFieldOption;

/** A `project` mapping row: Carbon id ↔ Ramp option UUID + last-pushed fingerprint. */
export type RampProjectMapping = RampFieldMapping;

/** What Carbon last pushed for an option: its label and whether it is selectable. */
export function projectFingerprint(option: {
  value: string;
  visible: boolean;
}): string {
  return fieldFingerprint(option);
}

/**
 * `POST /accounting/fields` body. Ramp keys a custom field by `id` (the ERP
 * remote id) and assigns its own `ramp_id` UUID, which the field-OPTIONS
 * endpoints want in `field_id`. `display_name` is the label card holders see.
 */
export function buildProjectFieldBody(name: string) {
  return buildFieldBody(RAMP_PROJECT_FIELD_ID, name);
}

/** `POST /accounting/field-options` body: option `id` is the Carbon project.id. */
export function buildProjectOptionsBody(
  fieldRampId: string,
  options: RampProjectOption[]
) {
  return buildFieldOptionsBody(fieldRampId, options);
}

/**
 * Pure diff of Carbon's projects against the options Ramp already holds
 * (existence + `ramp_id` come from the remote listing) and against what Carbon
 * last pushed (the mapping fingerprint decides whether a rename or a visibility
 * change is Carbon's to make). A Ramp-side manual edit therefore survives until
 * the Carbon side changes. A project gone from Carbon's ACTIVE set (deleted =
 * soft-deleted, or renamed) is HIDDEN, never deleted — the option may still be
 * on synced transactions.
 */
export function diffProjectOptions(
  desired: RampProjectOption[],
  remote: RampRemoteFieldOption[],
  mappings: RampProjectMapping[]
): {
  toCreate: RampProjectOption[];
  toRename: Array<{ option: RampProjectOption; rampId: string }>;
  toShow: Array<{ option: RampProjectOption; rampId: string }>;
  toHide: Array<{ id: string; value: string; rampId: string }>;
} {
  return diffFieldOptions(desired, remote, mappings);
}

/** The parameters that specialise the shared converge for projects. */
const PROJECT_SPEC: CustomSingleChoiceFieldSpec = {
  fieldId: RAMP_PROJECT_FIELD_ID,
  optionEntityType: "project",
  fieldEntityType: "projectField",
  dimensionEntityType: "Project",
  dimensionName: "Project",
  messages: {
    loadMappings: "Failed to load Ramp project mappings",
    recordMappings: "Failed to record Ramp project mappings",
    loadDimension: "Failed to load the Project dimension",
    createDimension: "Failed to create the Project dimension",
    missingFieldRampId: "Ramp did not return a ramp_id for the project field",
    loadFieldMapping: "Failed to load the Ramp project field mapping",
    recordFieldMapping: "Failed to record the Ramp project field mapping"
  },
  loadDesiredOptions: async (serviceRole, companyId) => {
    const { data: projects, error } = await serviceRole
      .from("project")
      .select("id, name")
      .eq("companyId", companyId)
      .eq("active", true);
    if (error) {
      throw new Error(`Failed to load projects: ${error.message}`);
    }
    return (projects ?? []).map((row) => ({
      id: row.id,
      value: row.name
    }));
  }
};

/**
 * The company group's active `Project` dimension. Slice 2 of the Projects
 * feature seeds one per company group (migration + seed.data.ts), so this
 * normally FINDS it; it creates one only as a safety net for a group with none.
 * The posting functions write every line's project as a `journalLineDimension`
 * against this row, and its `name` names the Ramp field. `dimension` is
 * companyGroup-scoped.
 */
export async function ensureProjectDimension(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<{ id: string; name: string }> {
  return ensureCustomFieldDimension(serviceRole, companyId, PROJECT_SPEC);
}

/**
 * Converge Carbon's ACTIVE projects into Ramp as the options of one custom
 * single-choice field, as a true diff: create new, rename changed, hide removed
 * (a soft-deleted / inactive project falls out of `desired` → HIDDEN), re-show
 * restored — tracked per project in `externalIntegrationMapping` (entityType
 * `project`). Runs on install / settings save and on every `ramp-sync`, so a
 * project added in Carbon reaches Ramp within ≤1h. An unchanged set is a cheap
 * no-op. Kept entirely separate from the cost-center field.
 */
export async function pushProjects(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<{
  created: number;
  renamed: number;
  hidden: number;
  shown: number;
  pushed: number;
}> {
  return pushCustomSingleChoiceField(serviceRole, companyId, PROJECT_SPEC);
}
