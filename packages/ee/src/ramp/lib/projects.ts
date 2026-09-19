import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk, RAMP_ACCOUNTS_BATCH_SIZE } from "./chart-of-accounts";
import { RampApiError, type RampClient } from "./client";
import { RAMP_PROJECT_FIELD_ID } from "./coding";
import { getRampIntegration, RAMP } from "./connection";
import type { RampRemoteFieldOption } from "./cost-centers";

// /********************************************************\
// *        Projects — the custom "project" field           *
// \********************************************************/

/** The Carbon project as a Ramp option: `id` = project.id, `value` = name. */
export type RampProjectOption = { id: string; value: string };

/** A `project` mapping row: Carbon id ↔ Ramp option UUID + last-pushed fingerprint. */
export type RampProjectMapping = {
  entityId: string;
  externalId: string | null;
  fingerprint: string | null;
};

/** What Carbon last pushed for an option: its label and whether it is selectable. */
export function projectFingerprint(option: {
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
export function buildProjectFieldBody(name: string) {
  return {
    id: RAMP_PROJECT_FIELD_ID,
    name,
    display_name: name,
    input_type: "SINGLE_CHOICE",
    is_splittable: true
  };
}

/** `POST /accounting/field-options` body: option `id` is the Carbon project.id. */
export function buildProjectOptionsBody(
  fieldRampId: string,
  options: RampProjectOption[]
) {
  return {
    field_id: fieldRampId,
    options: options.map((option) => ({ id: option.id, value: option.value }))
  };
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
  const remoteById = new Map<string, RampRemoteFieldOption>();
  for (const option of remote) {
    if (option.id && option.ramp_id) remoteById.set(option.id, option);
  }
  const mappingById = new Map(mappings.map((m) => [m.entityId, m]));
  const desiredIds = new Set(desired.map((option) => option.id));

  const toCreate: RampProjectOption[] = [];
  const toRename: Array<{ option: RampProjectOption; rampId: string }> = [];
  const toShow: Array<{ option: RampProjectOption; rampId: string }> = [];
  const toHide: Array<{ id: string; value: string; rampId: string }> = [];

  for (const option of desired) {
    const existing = remoteById.get(option.id);
    if (!existing?.ramp_id) {
      toCreate.push(option);
      continue;
    }
    const last = mappingById.get(option.id)?.fingerprint;
    const current = projectFingerprint({
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

async function loadProjectMappings(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<RampProjectMapping[]> {
  const { data, error } = await serviceRole
    .from("externalIntegrationMapping")
    .select("entityId, externalId, metadata")
    .eq("companyId", companyId)
    .eq("integration", RAMP)
    .eq("entityType", "project");
  if (error) {
    throw new Error(`Failed to load Ramp project mappings: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    entityId: row.entityId,
    externalId: row.externalId,
    fingerprint:
      (row.metadata as { fingerprint?: string } | null)?.fingerprint ?? null
  }));
}

/** Record what Carbon just pushed for each option (Ramp UUID + fingerprint). */
async function upsertProjectMappings(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  rows: Array<{ id: string; rampId: string; value: string; visible: boolean }>
): Promise<void> {
  if (rows.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await serviceRole.from("externalIntegrationMapping").upsert(
    rows.map((row) => ({
      entityType: "project",
      entityId: row.id,
      integration: RAMP,
      externalId: row.rampId,
      companyId,
      metadata: {
        fingerprint: projectFingerprint({
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
    throw new Error(`Failed to record Ramp project mappings: ${error.message}`);
  }
}

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
    .eq("entityType", "Project")
    .eq("active", true)
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    throw new Error(
      `Failed to load the Project dimension: ${existing.error.message}`
    );
  }
  if (existing.data) return existing.data;

  const created = await serviceRole
    .from("dimension")
    .insert([
      {
        name: "Project",
        entityType: "Project",
        companyGroupId,
        createdBy: "system"
      }
    ])
    .select("id, name")
    .single();
  if (created.error || !created.data) {
    throw new Error(
      `Failed to create the Project dimension: ${
        created.error?.message ?? "unknown error"
      }`
    );
  }
  return created.data;
}

/**
 * Ensure the custom project field exists in Ramp under
 * {@link RAMP_PROJECT_FIELD_ID} and carries the dimension's name. Read first so
 * a re-run is a no-op; create when absent (the POST is idempotent by `id`);
 * PATCH the name only when Carbon's name changed since Carbon last pushed it, so
 * a Ramp-side rename by the customer survives. Returns Ramp's UUID for the field.
 */
async function ensureProjectField(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  client: RampClient,
  name: string
): Promise<string> {
  let field: { ramp_id?: string | null; name?: string | null } | null = null;
  for await (const page of client.listAccountingFields({
    remote_id: RAMP_PROJECT_FIELD_ID
  })) {
    field = page.find((row) => row.id === RAMP_PROJECT_FIELD_ID) ?? field;
    if (field) break;
  }

  if (!field?.ramp_id) {
    const created = await client.postAccountingFields<{
      ramp_id?: string | null;
    }>(buildProjectFieldBody(name));
    let rampId = created?.ramp_id ?? null;
    if (!rampId) {
      // Some responses omit ramp_id on the create; the listing always has it.
      for await (const page of client.listAccountingFields({
        remote_id: RAMP_PROJECT_FIELD_ID
      })) {
        rampId =
          page.find((row) => row.id === RAMP_PROJECT_FIELD_ID)?.ramp_id ??
          rampId;
        if (rampId) break;
      }
    }
    if (!rampId) {
      throw new Error("Ramp did not return a ramp_id for the project field");
    }
    await upsertProjectFieldMapping(serviceRole, companyId, rampId, name);
    return rampId;
  }

  const [mapping] = await loadProjectFieldMapping(serviceRole, companyId);
  if (mapping?.fingerprint !== name) {
    await client.patchAccountingField(field.ramp_id, {
      name,
      display_name: name
    });
    await upsertProjectFieldMapping(
      serviceRole,
      companyId,
      field.ramp_id,
      name
    );
  }
  return field.ramp_id;
}

async function loadProjectFieldMapping(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<RampProjectMapping[]> {
  const { data, error } = await serviceRole
    .from("externalIntegrationMapping")
    .select("entityId, externalId, metadata")
    .eq("companyId", companyId)
    .eq("integration", RAMP)
    .eq("entityType", "projectField")
    .eq("entityId", RAMP_PROJECT_FIELD_ID);
  if (error) {
    throw new Error(
      `Failed to load the Ramp project field mapping: ${error.message}`
    );
  }
  return (data ?? []).map((row) => ({
    entityId: row.entityId,
    externalId: row.externalId,
    fingerprint:
      (row.metadata as { fingerprint?: string } | null)?.fingerprint ?? null
  }));
}

async function upsertProjectFieldMapping(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  rampId: string,
  name: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await serviceRole.from("externalIntegrationMapping").upsert(
    [
      {
        entityType: "projectField",
        entityId: RAMP_PROJECT_FIELD_ID,
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
      `Failed to record the Ramp project field mapping: ${error.message}`
    );
  }
}

async function listRemoteProjectOptions(
  client: RampClient
): Promise<RampRemoteFieldOption[]> {
  const options: RampRemoteFieldOption[] = [];
  for await (const page of client.listAccountingFieldOptions({
    field_remote_id: RAMP_PROJECT_FIELD_ID
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
async function renameProjectOption(
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
  const zero = { created: 0, renamed: 0, hidden: 0, shown: 0, pushed: 0 };
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) return zero;

  const { client } = integration;

  const dimension = await ensureProjectDimension(serviceRole, companyId);

  const { data: projects, error } = await serviceRole
    .from("project")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("active", true);
  if (error) {
    throw new Error(`Failed to load projects: ${error.message}`);
  }
  const desired: RampProjectOption[] = (projects ?? []).map((row) => ({
    id: row.id,
    value: row.name
  }));

  const fieldRampId = await ensureProjectField(
    serviceRole,
    companyId,
    client,
    dimension.name
  );

  const remote = await listRemoteProjectOptions(client);
  const mappings = await loadProjectMappings(serviceRole, companyId);
  const { toCreate, toRename, toShow, toHide } = diffProjectOptions(
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
      buildProjectOptionsBody(fieldRampId, batch)
    );
    created += batch.length;
  }
  // The upload response shape is not relied on: re-list to learn the new
  // options' ramp_ids (the id the PATCH endpoint keys on) for the mappings.
  const rampIdById = new Map<string, string>();
  const afterCreate =
    created > 0 ? await listRemoteProjectOptions(client) : remote;
  for (const option of afterCreate) {
    if (option.id && option.ramp_id) rampIdById.set(option.id, option.ramp_id);
  }
  await upsertProjectMappings(
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
    await renameProjectOption(client, rampId, option.value);
  }
  for (const { rampId } of toShow) {
    await client.patchAccountingFieldOption(rampId, { visibility: "VISIBLE" });
  }
  await upsertProjectMappings(
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
  await upsertProjectMappings(
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
