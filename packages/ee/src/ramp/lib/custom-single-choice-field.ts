import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "./chart-of-accounts";
import { RampApiError, type RampClient } from "./client";
import { RAMP_FIELD_OPTIONS_BATCH_SIZE } from "./coding";
import { getRampIntegration, RAMP } from "./connection";

// /********************************************************\
// *   Custom SINGLE_CHOICE field convergence (shared)     *
// \********************************************************/

/**
 * The convergence engine behind `pushCostCenters` (`cost-centers.ts`) and
 * `pushProjects` (`projects.ts`): a Carbon entity's rows become the options of
 * ONE custom Ramp `SINGLE_CHOICE` accounting field, kept in sync as a true diff
 * (create new, rename changed, HIDE removed, re-show restored) tracked per option
 * in `externalIntegrationMapping`. The two callers differ only in the field id,
 * the mapping entity-type strings, the dimension identity, the source table that
 * supplies the desired option set, and the error-message copy — everything else
 * (find-or-create-by-id + name-PATCH, all-or-nothing batching, fingerprints, the
 * "never recorded" adoption branch) is here, once. Server-only (it reaches the
 * vault via `getRampIntegration`); never import it from `config.tsx`.
 */

/** A Carbon entity as a Ramp option: `id` = the entity id, `value` = its name. */
export type RampFieldOption = { id: string; value: string };

/** A mapping row: Carbon id ↔ Ramp option UUID + last-pushed fingerprint. */
export type RampFieldMapping = {
  entityId: string;
  externalId: string | null;
  fingerprint: string | null;
};

/** The subset of a Ramp field option the converge reads back. */
export type RampRemoteFieldOption = {
  id?: string | null;
  ramp_id?: string | null;
  value?: string | null;
  display_name?: string | null;
  visibility?: string | null;
};

/**
 * Everything that distinguishes one custom single-choice field from another. The
 * `messages` copy is carried per-caller so a refusal reads exactly as it did
 * before this was shared, and `loadDesiredOptions` is where each caller reads its
 * own source table (with its own load-error message).
 */
export type CustomSingleChoiceFieldSpec = {
  /** The remote id Carbon creates the custom field with (RAMP_*_FIELD_ID). */
  fieldId: string;
  /** `externalIntegrationMapping.entityType` for each option row. */
  optionEntityType: string;
  /** `externalIntegrationMapping.entityType` for the field row. */
  fieldEntityType: string;
  /** `dimension.entityType` for the concept. */
  dimensionEntityType: Database["public"]["Enums"]["dimensionEntityType"];
  /** `dimension.name` used when the dimension has to be created. */
  dimensionName: string;
  /** Error-message prefixes, kept per-caller for identical refusal copy. */
  messages: {
    loadMappings: string;
    recordMappings: string;
    loadDimension: string;
    createDimension: string;
    missingFieldRampId: string;
    loadFieldMapping: string;
    recordFieldMapping: string;
  };
  /** Load Carbon's desired option set (id + value) from its own source table. */
  loadDesiredOptions: (
    serviceRole: SupabaseClient<Database>,
    companyId: string
  ) => Promise<RampFieldOption[]>;
};

/** What Carbon last pushed for an option: its label and whether it is selectable. */
export function fieldFingerprint(option: {
  value: string;
  visible: boolean;
}): string {
  return `${option.value}|${option.visible ? "VISIBLE" : "HIDDEN"}`;
}

/**
 * `POST /accounting/fields` body. Ramp keys a custom field by `id` (the ERP
 * remote id) and assigns its own `ramp_id` UUID, which the field-OPTIONS
 * endpoints want in `field_id`. `display_name` is the label card holders see.
 */
export function buildFieldBody(fieldId: string, name: string) {
  return {
    id: fieldId,
    name,
    display_name: name,
    input_type: "SINGLE_CHOICE",
    is_splittable: true
  };
}

/** `POST /accounting/field-options` body: option `id` is the Carbon entity id. */
export function buildFieldOptionsBody(
  fieldRampId: string,
  options: RampFieldOption[]
) {
  return {
    field_id: fieldRampId,
    options: options.map((option) => ({ id: option.id, value: option.value }))
  };
}

/**
 * Pure diff of Carbon's desired options against the options Ramp already holds
 * (existence + `ramp_id` come from the remote listing) and against what Carbon
 * last pushed (the mapping fingerprint decides whether a rename or a visibility
 * change is Carbon's to make). A Ramp-side manual edit therefore survives until
 * the Carbon side changes. An option gone from Carbon's desired set is HIDDEN,
 * never deleted — the option may still be on synced transactions.
 */
export function diffFieldOptions(
  desired: RampFieldOption[],
  remote: RampRemoteFieldOption[],
  mappings: RampFieldMapping[]
): {
  toCreate: RampFieldOption[];
  toRename: Array<{ option: RampFieldOption; rampId: string }>;
  toShow: Array<{ option: RampFieldOption; rampId: string }>;
  toHide: Array<{ id: string; value: string; rampId: string }>;
} {
  const remoteById = new Map<string, RampRemoteFieldOption>();
  for (const option of remote) {
    if (option.id && option.ramp_id) remoteById.set(option.id, option);
  }
  const mappingById = new Map(mappings.map((m) => [m.entityId, m]));
  const desiredIds = new Set(desired.map((option) => option.id));

  const toCreate: RampFieldOption[] = [];
  const toRename: Array<{ option: RampFieldOption; rampId: string }> = [];
  const toShow: Array<{ option: RampFieldOption; rampId: string }> = [];
  const toHide: Array<{ id: string; value: string; rampId: string }> = [];

  for (const option of desired) {
    const existing = remoteById.get(option.id);
    if (!existing?.ramp_id) {
      toCreate.push(option);
      continue;
    }
    const last = mappingById.get(option.id)?.fingerprint;
    const current = fieldFingerprint({
      value: option.value,
      visible: true
    });
    if (last === current) continue;
    const [lastValue, lastVisibility] = last ? last.split("|") : [];
    if (last === undefined) {
      // Never recorded (pushed before this was mapping-tracked): adopt the
      // remote option, correcting only what visibly disagrees with Carbon.
      if ((existing.display_name ?? existing.value) !== option.value) {
        toRename.push({ option, rampId: existing.ramp_id });
      }
      if (existing.visibility === "HIDDEN") {
        toShow.push({ option, rampId: existing.ramp_id });
      }
      continue;
    }
    if (lastValue !== option.value) {
      toRename.push({ option, rampId: existing.ramp_id });
    }
    if (lastVisibility === "HIDDEN") {
      toShow.push({ option, rampId: existing.ramp_id });
    }
  }

  for (const option of remote) {
    if (!option.id || !option.ramp_id || desiredIds.has(option.id)) continue;
    const last = mappingById.get(option.id)?.fingerprint;
    const alreadyHidden = last ? last.endsWith("|HIDDEN") : false;
    if (alreadyHidden || option.visibility === "HIDDEN") continue;
    toHide.push({
      id: option.id,
      value: option.value ?? option.display_name ?? "",
      rampId: option.ramp_id
    });
  }

  return { toCreate, toRename, toShow, toHide };
}

async function loadMappings(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  spec: CustomSingleChoiceFieldSpec
): Promise<RampFieldMapping[]> {
  const { data, error } = await serviceRole
    .from("externalIntegrationMapping")
    .select("entityId, externalId, metadata")
    .eq("companyId", companyId)
    .eq("integration", RAMP)
    .eq("entityType", spec.optionEntityType);
  if (error) {
    throw new Error(`${spec.messages.loadMappings}: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    entityId: row.entityId,
    externalId: row.externalId,
    fingerprint:
      (row.metadata as { fingerprint?: string } | null)?.fingerprint ?? null
  }));
}

/** Record what Carbon just pushed for each option (Ramp UUID + fingerprint). */
async function upsertMappings(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  rows: Array<{ id: string; rampId: string; value: string; visible: boolean }>,
  spec: CustomSingleChoiceFieldSpec
): Promise<void> {
  if (rows.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await serviceRole.from("externalIntegrationMapping").upsert(
    rows.map((row) => ({
      entityType: spec.optionEntityType,
      entityId: row.id,
      integration: RAMP,
      externalId: row.rampId,
      companyId,
      metadata: {
        fingerprint: fieldFingerprint({
          value: row.value,
          visible: row.visible
        })
      },
      lastSyncedAt: now,
      remoteUpdatedAt: now,
      updatedAt: now
    })),
    { onConflict: "entityType,entityId,integration,companyId" }
  );
  if (error) {
    throw new Error(`${spec.messages.recordMappings}: ${error.message}`);
  }
}

/**
 * The company group's active dimension for the spec's `entityType`. It is
 * normally seeded elsewhere, so this usually FINDS it; it creates one only as a
 * safety net for a group with none. The posting functions write every line's tag
 * as a `journalLineDimension` against this row, and its `name` names the Ramp
 * field. `dimension` is companyGroup-scoped.
 */
export async function ensureCustomFieldDimension(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  spec: CustomSingleChoiceFieldSpec
): Promise<{ id: string; name: string }> {
  const { data: company, error: companyError } = await serviceRole
    .from("company")
    .select("companyGroupId")
    .eq("id", companyId)
    .single();
  if (companyError || !company?.companyGroupId) {
    throw new Error(
      `Failed to resolve company group for ${companyId}: ${
        companyError?.message ?? "no companyGroupId"
      }`
    );
  }
  const companyGroupId = company.companyGroupId;

  const existing = await serviceRole
    .from("dimension")
    .select("id, name")
    .eq("companyGroupId", companyGroupId)
    .eq("entityType", spec.dimensionEntityType)
    .eq("active", true)
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    throw new Error(
      `${spec.messages.loadDimension}: ${existing.error.message}`
    );
  }
  if (existing.data) return existing.data;

  const created = await serviceRole
    .from("dimension")
    .insert([
      {
        name: spec.dimensionName,
        entityType: spec.dimensionEntityType,
        companyGroupId,
        createdBy: "system"
      }
    ])
    .select("id, name")
    .single();
  if (created.error || !created.data) {
    throw new Error(
      `${spec.messages.createDimension}: ${
        created.error?.message ?? "unknown error"
      }`
    );
  }
  return created.data;
}

/**
 * Ensure the custom field exists in Ramp under `spec.fieldId` and carries the
 * dimension's name. Read first so a re-run is a no-op; create when absent (the
 * POST is idempotent by `id`); PATCH the name only when Carbon's name changed
 * since Carbon last pushed it, so a Ramp-side rename by the customer survives.
 * Returns Ramp's UUID for the field.
 */
async function ensureCustomField(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  client: RampClient,
  name: string,
  spec: CustomSingleChoiceFieldSpec
): Promise<string> {
  let field: { ramp_id?: string | null; name?: string | null } | null = null;
  for await (const page of client.listAccountingFields({
    remote_id: spec.fieldId
  })) {
    field = page.find((row) => row.id === spec.fieldId) ?? field;
    if (field) break;
  }

  if (!field?.ramp_id) {
    const created = await client.postAccountingFields<{
      ramp_id?: string | null;
    }>(buildFieldBody(spec.fieldId, name));
    let rampId = created?.ramp_id ?? null;
    if (!rampId) {
      // Some responses omit ramp_id on the create; the listing always has it.
      for await (const page of client.listAccountingFields({
        remote_id: spec.fieldId
      })) {
        rampId = page.find((row) => row.id === spec.fieldId)?.ramp_id ?? rampId;
        if (rampId) break;
      }
    }
    if (!rampId) {
      throw new Error(spec.messages.missingFieldRampId);
    }
    await upsertFieldMapping(serviceRole, companyId, rampId, name, spec);
    return rampId;
  }

  const [mapping] = await loadFieldMapping(serviceRole, companyId, spec);
  if (mapping?.fingerprint !== name) {
    await client.patchAccountingField(field.ramp_id, {
      name,
      display_name: name
    });
    await upsertFieldMapping(serviceRole, companyId, field.ramp_id, name, spec);
  }
  return field.ramp_id;
}

async function loadFieldMapping(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  spec: CustomSingleChoiceFieldSpec
): Promise<RampFieldMapping[]> {
  const { data, error } = await serviceRole
    .from("externalIntegrationMapping")
    .select("entityId, externalId, metadata")
    .eq("companyId", companyId)
    .eq("integration", RAMP)
    .eq("entityType", spec.fieldEntityType)
    .eq("entityId", spec.fieldId);
  if (error) {
    throw new Error(`${spec.messages.loadFieldMapping}: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    entityId: row.entityId,
    externalId: row.externalId,
    fingerprint:
      (row.metadata as { fingerprint?: string } | null)?.fingerprint ?? null
  }));
}

async function upsertFieldMapping(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  rampId: string,
  name: string,
  spec: CustomSingleChoiceFieldSpec
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await serviceRole.from("externalIntegrationMapping").upsert(
    [
      {
        entityType: spec.fieldEntityType,
        entityId: spec.fieldId,
        integration: RAMP,
        externalId: rampId,
        companyId,
        metadata: { fingerprint: name },
        lastSyncedAt: now,
        remoteUpdatedAt: now,
        updatedAt: now
      }
    ],
    { onConflict: "entityType,entityId,integration,companyId" }
  );
  if (error) {
    throw new Error(`${spec.messages.recordFieldMapping}: ${error.message}`);
  }
}

async function listRemoteOptions(
  client: RampClient,
  spec: CustomSingleChoiceFieldSpec
): Promise<RampRemoteFieldOption[]> {
  const options: RampRemoteFieldOption[] = [];
  for await (const page of client.listAccountingFieldOptions({
    field_remote_id: spec.fieldId
  })) {
    options.push(...page);
  }
  return options;
}

/**
 * Rename an option. `value` is only PATCHable on non-direct connections per the
 * Ramp spec, and whether an API accounting connection counts is not
 * documented — so try both keys and fall back to `display_name` alone.
 */
async function renameOption(
  client: RampClient,
  rampId: string,
  value: string
): Promise<void> {
  try {
    await client.patchAccountingFieldOption(rampId, {
      value,
      display_name: value
    });
  } catch (err) {
    if (!(err instanceof RampApiError) || err.status >= 500) throw err;
    await client.patchAccountingFieldOption(rampId, { display_name: value });
  }
}

/**
 * Converge Carbon's desired options into Ramp as the options of one custom
 * single-choice field, as a true diff: create new, rename changed, hide removed,
 * re-show restored — tracked per option in `externalIntegrationMapping`. Runs on
 * install / settings save and on every `ramp-sync`, so a change reaches Ramp
 * within ≤1h. An unchanged set is a cheap no-op.
 *
 * `POST /accounting/field-options` is all-or-nothing and rejects options that
 * already exist, which is why the diff is driven off the remote listing rather
 * than a blind re-post.
 */
export async function pushCustomSingleChoiceField(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  spec: CustomSingleChoiceFieldSpec
): Promise<{
  created: number;
  renamed: number;
  hidden: number;
  shown: number;
  pushed: number;
}> {
  const zero = { created: 0, renamed: 0, hidden: 0, shown: 0, pushed: 0 };
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) return zero;

  const { client } = integration;

  const dimension = await ensureCustomFieldDimension(
    serviceRole,
    companyId,
    spec
  );

  const desired = await spec.loadDesiredOptions(serviceRole, companyId);

  const fieldRampId = await ensureCustomField(
    serviceRole,
    companyId,
    client,
    dimension.name,
    spec
  );

  const remote = await listRemoteOptions(client, spec);
  const mappings = await loadMappings(serviceRole, companyId, spec);
  const { toCreate, toRename, toShow, toHide } = diffFieldOptions(
    desired,
    remote,
    mappings
  );
  if (
    toCreate.length === 0 &&
    toRename.length === 0 &&
    toShow.length === 0 &&
    toHide.length === 0
  ) {
    return zero;
  }

  let created = 0;
  for (const batch of chunk(toCreate, RAMP_FIELD_OPTIONS_BATCH_SIZE)) {
    await client.postAccountingFieldOptions(
      buildFieldOptionsBody(fieldRampId, batch)
    );
    created += batch.length;
  }
  // The upload response shape is not relied on: re-list to learn the new
  // options' ramp_ids (the id the PATCH endpoint keys on) for the mappings.
  const rampIdById = new Map<string, string>();
  const afterCreate =
    created > 0 ? await listRemoteOptions(client, spec) : remote;
  for (const option of afterCreate) {
    if (option.id && option.ramp_id) rampIdById.set(option.id, option.ramp_id);
  }
  await upsertMappings(
    serviceRole,
    companyId,
    toCreate.flatMap((option) => {
      const rampId = rampIdById.get(option.id);
      return rampId
        ? [{ id: option.id, rampId, value: option.value, visible: true }]
        : [];
    }),
    spec
  );

  for (const { option, rampId } of toRename) {
    await renameOption(client, rampId, option.value);
  }
  for (const { rampId } of toShow) {
    await client.patchAccountingFieldOption(rampId, { visibility: "VISIBLE" });
  }
  await upsertMappings(
    serviceRole,
    companyId,
    [...toRename, ...toShow].map(({ option, rampId }) => ({
      id: option.id,
      rampId,
      value: option.value,
      visible: true
    })),
    spec
  );

  for (const { rampId } of toHide) {
    await client.patchAccountingFieldOption(rampId, { visibility: "HIDDEN" });
  }
  await upsertMappings(
    serviceRole,
    companyId,
    toHide.map(({ id, rampId, value }) => ({
      id,
      rampId,
      value,
      visible: false
    })),
    spec
  );

  return {
    created,
    renamed: toRename.length,
    hidden: toHide.length,
    shown: toShow.length,
    pushed: created + toRename.length + toShow.length + toHide.length
  };
}
