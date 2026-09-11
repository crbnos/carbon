import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk, RAMP_ACCOUNTS_BATCH_SIZE } from "./chart-of-accounts";
import { RampApiError, type RampClient } from "./client";
import { RAMP_COST_CENTER_FIELD_ID } from "./coding";
import { getRampIntegration, RAMP } from "./connection";

// /********************************************************\
// *        Cost centers — the custom "project" field        *
// \********************************************************/

/** The Carbon cost center as a Ramp option: `id` = costCenter.id, `value` = name. */
export type RampCostCenterOption = { id: string; value: string };

/** A `costCenter` mapping row: Carp id ↔ Ramp option UUID + last-pushed fingerprint. */
export type RampCostCenterMapping = {
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

/** What Carbon last pushed for an option: its label and whether it is selectable. */
export function costCenterFingerprint(option: {
  value: string;
  visible: boolean;
}): string {
  return `${option.value}|${option.visible ? "VISIBLE" : "HIDDEN"}`;
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
  return {
    id: RAMP_COST_CENTER_FIELD_ID,
    name,
    display_name: name,
    input_type: "SINGLE_CHOICE",
    is_splittable: true
  };
}

/** `POST /accounting/field-options` body: option `id` is the Carbon costCenter.id. */
export function buildCostCenterOptionsBody(
  fieldRampId: string,
  options: RampCostCenterOption[]
) {
  return {
    field_id: fieldRampId,
    options: options.map((option) => ({ id: option.id, value: option.value }))
  };
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
  const remoteById = new Map<string, RampRemoteFieldOption>();
  for (const option of remote) {
    if (option.id && option.ramp_id) remoteById.set(option.id, option);
  }
  const mappingById = new Map(mappings.map((m) => [m.entityId, m]));
  const desiredIds = new Set(desired.map((option) => option.id));

  const toCreate: RampCostCenterOption[] = [];
  const toRename: Array<{ option: RampCostCenterOption; rampId: string }> = [];
  const toShow: Array<{ option: RampCostCenterOption; rampId: string }> = [];
  const toHide: Array<{ id: string; value: string; rampId: string }> = [];

  for (const option of desired) {
    const existing = remoteById.get(option.id);
    if (!existing?.ramp_id) {
      toCreate.push(option);
      continue;
    }
    const last = mappingById.get(option.id)?.fingerprint;
    const current = costCenterFingerprint({
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

async function loadCostCenterMappings(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<RampCostCenterMapping[]> {
  const { data, error } = await serviceRole
    .from("externalIntegrationMapping")
    .select("entityId, externalId, metadata")
    .eq("companyId", companyId)
    .eq("integration", RAMP)
    .eq("entityType", "costCenter");
  if (error) {
    throw new Error(
      `Failed to load Ramp cost-center mappings: ${error.message}`
    );
  }
  return (data ?? []).map((row) => ({
    entityId: row.entityId,
    externalId: row.externalId,
    fingerprint:
      (row.metadata as { fingerprint?: string } | null)?.fingerprint ?? null
  }));
}

/** Record what Carbon just pushed for each option (Ramp UUID + fingerprint). */
async function upsertCostCenterMappings(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  rows: Array<{ id: string; rampId: string; value: string; visible: boolean }>
): Promise<void> {
  if (rows.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await serviceRole.from("externalIntegrationMapping").upsert(
    rows.map((row) => ({
      entityType: "costCenter",
      entityId: row.id,
      integration: RAMP,
      externalId: row.rampId,
      companyId,
      metadata: {
        fingerprint: costCenterFingerprint({
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
    throw new Error(
      `Failed to record Ramp cost-center mappings: ${error.message}`
    );
  }
}

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
    .eq("entityType", "CostCenter")
    .eq("active", true)
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    throw new Error(
      `Failed to load the Cost Center dimension: ${existing.error.message}`
    );
  }
  if (existing.data) return existing.data;

  const created = await serviceRole
    .from("dimension")
    .insert([
      {
        name: "Cost Center",
        entityType: "CostCenter",
        companyGroupId,
        createdBy: "system"
      }
    ])
    .select("id, name")
    .single();
  if (created.error || !created.data) {
    throw new Error(
      `Failed to create the Cost Center dimension: ${
        created.error?.message ?? "unknown error"
      }`
    );
  }
  return created.data;
}

/**
 * Ensure the custom cost-center field exists in Ramp under
 * {@link RAMP_COST_CENTER_FIELD_ID} and carries the dimension's name. Read
 * first (`GET /accounting/fields?remote_id=`) so a re-run is a no-op; create
 * when absent (the POST is idempotent by `id` anyway); PATCH the name only when
 * Carbon's name changed since Carbon last pushed it, so a Ramp-side rename by
 * the customer survives. Returns Ramp's UUID for the field.
 */
async function ensureCostCenterField(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  client: RampClient,
  name: string
): Promise<string> {
  let field: { ramp_id?: string | null; name?: string | null } | null = null;
  for await (const page of client.listAccountingFields({
    remote_id: RAMP_COST_CENTER_FIELD_ID
  })) {
    field = page.find((row) => row.id === RAMP_COST_CENTER_FIELD_ID) ?? field;
    if (field) break;
  }

  if (!field?.ramp_id) {
    const created = await client.postAccountingFields<{
      ramp_id?: string | null;
    }>(buildCostCenterFieldBody(name));
    let rampId = created?.ramp_id ?? null;
    if (!rampId) {
      // Some responses omit ramp_id on the create; the listing always has it.
      for await (const page of client.listAccountingFields({
        remote_id: RAMP_COST_CENTER_FIELD_ID
      })) {
        rampId =
          page.find((row) => row.id === RAMP_COST_CENTER_FIELD_ID)?.ramp_id ??
          rampId;
        if (rampId) break;
      }
    }
    if (!rampId) {
      throw new Error(
        "Ramp did not return a ramp_id for the cost-center field"
      );
    }
    await upsertCostCenterFieldMapping(serviceRole, companyId, rampId, name);
    return rampId;
  }

  const [mapping] = await loadFieldMapping(serviceRole, companyId);
  if (mapping?.fingerprint !== name) {
    await client.patchAccountingField(field.ramp_id, {
      name,
      display_name: name
    });
    await upsertCostCenterFieldMapping(
      serviceRole,
      companyId,
      field.ramp_id,
      name
    );
  }
  return field.ramp_id;
}

async function loadFieldMapping(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<RampCostCenterMapping[]> {
  const { data, error } = await serviceRole
    .from("externalIntegrationMapping")
    .select("entityId, externalId, metadata")
    .eq("companyId", companyId)
    .eq("integration", RAMP)
    .eq("entityType", "costCenterField")
    .eq("entityId", RAMP_COST_CENTER_FIELD_ID);
  if (error) {
    throw new Error(`Failed to load the Ramp field mapping: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    entityId: row.entityId,
    externalId: row.externalId,
    fingerprint:
      (row.metadata as { fingerprint?: string } | null)?.fingerprint ?? null
  }));
}

async function upsertCostCenterFieldMapping(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  rampId: string,
  name: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await serviceRole.from("externalIntegrationMapping").upsert(
    [
      {
        entityType: "costCenterField",
        entityId: RAMP_COST_CENTER_FIELD_ID,
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
    throw new Error(
      `Failed to record the Ramp field mapping: ${error.message}`
    );
  }
}

async function listRemoteCostCenterOptions(
  client: RampClient
): Promise<RampRemoteFieldOption[]> {
  const options: RampRemoteFieldOption[] = [];
  for await (const page of client.listAccountingFieldOptions({
    field_remote_id: RAMP_COST_CENTER_FIELD_ID
  })) {
    options.push(...page);
  }
  return options;
}

/**
 * Rename an option. `value` is only PATCHable on non-direct connections per the
 * Ramp spec, and whether an API accounting connection counts is not
 * documented — so try both keys and fall back to `display_name` alone, which is
 * "available to all".
 */
async function renameCostCenterOption(
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
  const zero = { created: 0, renamed: 0, hidden: 0, shown: 0, pushed: 0 };
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) return zero;

  const { client } = integration;

  const dimension = await ensureCostCenterDimension(serviceRole, companyId);

  const { data: costCenters, error } = await serviceRole
    .from("costCenter")
    .select("id, name")
    .eq("companyId", companyId);
  if (error) {
    throw new Error(`Failed to load cost centers: ${error.message}`);
  }
  const desired: RampCostCenterOption[] = (costCenters ?? []).map((row) => ({
    id: row.id,
    value: row.name
  }));

  const fieldRampId = await ensureCostCenterField(
    serviceRole,
    companyId,
    client,
    dimension.name
  );

  const remote = await listRemoteCostCenterOptions(client);
  const mappings = await loadCostCenterMappings(serviceRole, companyId);
  const { toCreate, toRename, toShow, toHide } = diffCostCenterOptions(
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
  for (const batch of chunk(toCreate, RAMP_ACCOUNTS_BATCH_SIZE)) {
    await client.postAccountingFieldOptions(
      buildCostCenterOptionsBody(fieldRampId, batch)
    );
    created += batch.length;
  }
  // The upload response shape is not relied on: re-list to learn the new
  // options' ramp_ids (the id the PATCH endpoint keys on) for the mappings.
  const rampIdById = new Map<string, string>();
  const afterCreate =
    created > 0 ? await listRemoteCostCenterOptions(client) : remote;
  for (const option of afterCreate) {
    if (option.id && option.ramp_id) rampIdById.set(option.id, option.ramp_id);
  }
  await upsertCostCenterMappings(
    serviceRole,
    companyId,
    toCreate.flatMap((option) => {
      const rampId = rampIdById.get(option.id);
      return rampId
        ? [{ id: option.id, rampId, value: option.value, visible: true }]
        : [];
    })
  );

  for (const { option, rampId } of toRename) {
    await renameCostCenterOption(client, rampId, option.value);
  }
  for (const { rampId } of toShow) {
    await client.patchAccountingFieldOption(rampId, { visibility: "VISIBLE" });
  }
  await upsertCostCenterMappings(
    serviceRole,
    companyId,
    [...toRename, ...toShow].map(({ option, rampId }) => ({
      id: option.id,
      rampId,
      value: option.value,
      visible: true
    }))
  );

  for (const { rampId } of toHide) {
    await client.patchAccountingFieldOption(rampId, { visibility: "HIDDEN" });
  }
  await upsertCostCenterMappings(
    serviceRole,
    companyId,
    toHide.map(({ id, rampId, value }) => ({
      id,
      rampId,
      value,
      visible: false
    }))
  );

  return {
    created,
    renamed: toRename.length,
    hidden: toHide.length,
    shown: toShow.length,
    pushed: created + toRename.length + toShow.length + toHide.length
  };
}
