import type { Database } from "@carbon/database";
import { datetime } from "@carbon/utils";
import {
  type ActionOutcome,
  type CatalogAction,
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

    fields[column] = raw;
  }

  // The tenancy guarantee: a reference must belong to this company, whatever
  // supplied it. Skipping it would let a workflow point at another tenant's row.
  for (const [column, raw] of Object.entries(fields)) {
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

  return {
    ok: true,
    outputs: { record: entityValue(entity, target.id) },
    summary: `Updated ${Object.keys(fields).length} field(s).`
  };
}
