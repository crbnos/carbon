import type { Database } from "@carbon/database";
import { datetime } from "@carbon/utils";
import {
  type ActionOutcome,
  type CatalogAction,
  CUSTOM_FIELD_PREFIX,
  entityValue,
  REGISTRY_ENTRIES,
  type RuntimeValue
} from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toPlainValue } from "./values";

/** `user` carries no companyId — membership lives on `userToCompany`. */
const MEMBERSHIP: Record<
  string,
  { table: string; column: string } | undefined
> = {
  user: { table: "userToCompany", column: "userId" }
};

/** Reads through the owner's client, so RLS-refused and absent are one answer. */
async function existsInCompany(params: {
  client: SupabaseClient;
  table: string;
  id: string;
  companyId: string;
}): Promise<boolean> {
  const { client, id, companyId } = params;

  const membership = MEMBERSHIP[params.table];
  const table = membership?.table ?? params.table;
  const column = membership?.column ?? "id";

  const { data, error } = await client
    .from(table)
    .select(column)
    .eq(column, id)
    .eq("companyId", companyId)
    .maybeSingle();

  return !error && Boolean(data);
}

/** Writes the catalog's inert columns on one record, as the workflow's owner. */
export async function runUpdateAction(params: {
  client: SupabaseClient<Database>;
  companyId: string;
  ownerId: string;
  entity: string;
  inputs: Record<string, RuntimeValue>;
  action: CatalogAction;
}): Promise<ActionOutcome> {
  const { companyId, ownerId, entity, inputs, action } = params;

  // The entity is only known at run time; typing it costs a 350-way instantiation.
  const client = params.client as unknown as SupabaseClient;

  const table = REGISTRY_ENTRIES[entity]?.table;
  if (table === undefined) {
    return { ok: false, error: `That ${entity} could not be read.` };
  }

  const target = inputs[entity];
  if (target === undefined || target.kind !== "entity") {
    return { ok: false, error: "This step needs a record to update." };
  }

  const found = await existsInCompany({
    client,
    table,
    id: target.id,
    companyId
  });
  if (!found) return { ok: false, error: `That ${entity} could not be read.` };

  const fields: Record<string, unknown> = {};
  // Keyed by custom field id — the key inside the JSONB blob, not the prefixed input name.
  const customFields: Record<string, unknown> = {};

  for (const [column, value] of Object.entries(inputs)) {
    if (column === entity) continue;
    const spec = action.inputs[column];
    const raw = toPlainValue(value);

    if (raw === undefined) continue;
    // Blanking a column the customer can legitimately clear is a real edit; blanking one
    // the table rejects is not, so an unresolved value there means "leave it alone".
    if (raw === null && spec?.notNull) continue;

    if (
      raw !== null &&
      spec?.choices !== undefined &&
      !spec.choices.includes(String(raw))
    ) {
      return { ok: false, error: `"${String(raw)}" is not a valid ${column}.` };
    }

    if (column.startsWith(CUSTOM_FIELD_PREFIX)) {
      // The ERP's form layer writes every custom field as a FormData string, so the
      // blob holds strings whatever the declared type. `fromColumn` coerces back by
      // the DECLARED type on read, so a string here round-trips exactly.
      customFields[column.slice(CUSTOM_FIELD_PREFIX.length)] =
        raw === null ? null : String(raw);
      continue;
    }

    fields[column] = raw;
  }

  // The tenancy guarantee: a reference must belong to this company, whatever
  // supplied it. Skipping it would let a workflow point at another tenant's row.
  // A User/Customer/Supplier custom field is a reference like any other.
  const references: [string, unknown][] = [
    ...Object.entries(fields),
    ...Object.entries(customFields).map(
      ([fieldId, raw]) =>
        [`${CUSTOM_FIELD_PREFIX}${fieldId}`, raw] as [string, unknown]
    )
  ];

  for (const [column, raw] of references) {
    if (raw === null) continue;
    const spec = action.inputs[column];
    const scope =
      spec?.type.kind === "entity"
        ? REGISTRY_ENTRIES[spec.type.of]?.table
        : spec?.scopeTable;
    if (scope === undefined) continue;

    const belongs = await existsInCompany({
      client,
      table: scope,
      id: String(raw),
      companyId
    });
    if (!belongs) {
      return {
        ok: false,
        error: `The ${column} you chose is not in this company.`
      };
    }
  }

  if (Object.keys(fields).length > 0) {
    const { error } = await client
      .from(table)
      .update({
        ...fields,
        updatedBy: ownerId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", target.id)
      .eq("companyId", companyId);

    if (error) return { ok: false, error: error.message };
  }

  if (Object.keys(customFields).length > 0) {
    // One statement, server-side `||` merge: setting one field must not erase the
    // others, and a read-modify-write here would race a concurrent human edit.
    const { error } = await client.rpc("workflow_merge_custom_fields", {
      p_table: table,
      p_id: target.id,
      p_company_id: companyId,
      p_values: customFields
    });

    if (error) return { ok: false, error: error.message };
  }

  return {
    ok: true,
    outputs: { record: entityValue(entity, target.id) },
    summary: `Updated ${
      Object.keys(fields).length + Object.keys(customFields).length
    } field(s).`
  };
}
