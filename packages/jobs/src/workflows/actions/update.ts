import type { Database } from "@carbon/database";
import swaggerDocsSchema from "@carbon/database/swagger-docs-schema";
import {
  type ActionOutcome,
  type CatalogAction,
  entityValue,
  REGISTRY_ENTRIES,
  type RuntimeValue
} from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The slice of the generated swagger document this file reads. */
interface ColumnSchema {
  enum?: readonly string[];
}

interface SwaggerDefinitions {
  definitions: Record<
    string,
    { properties?: Record<string, ColumnSchema | undefined> } | undefined
  >;
}

// Cast rather than annotate: structurally checking a 180k-line literal is not free.
const DEFINITIONS = (swaggerDocsSchema as unknown as SwaggerDefinitions)
  .definitions;

/** `user` carries no companyId — membership lives on `userToCompany`. */
const MEMBERSHIP: Record<
  string,
  { table: string; column: string } | undefined
> = {
  user: { table: "userToCompany", column: "userId" }
};

/** A RuntimeValue as the plain value a column or a service function expects.
 * Exported so the create action converts identically. */
export function toPlainValue(value: RuntimeValue): unknown {
  if (value.kind === "entity") return value.id;
  if (value.kind === "list") return value.items.map(toPlainValue);
  // A date primitive already carries its ISO string; see runtime `fromColumn`.
  return value.value;
}

/** Reads through the owner's client, so RLS-refused and absent are one answer. */
async function existsInCompany(params: {
  client: SupabaseClient;
  entity: string;
  id: string;
  companyId: string;
}): Promise<boolean> {
  const { client, entity, id, companyId } = params;

  const membership = MEMBERSHIP[entity];
  const table = membership?.table ?? REGISTRY_ENTRIES[entity]?.table;
  if (table === undefined) return false;
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
    entity,
    id: target.id,
    companyId
  });
  if (!found) return { ok: false, error: `That ${entity} could not be read.` };

  const properties = DEFINITIONS[table]?.properties ?? {};
  const fields: Record<string, unknown> = {};

  for (const [column, value] of Object.entries(inputs)) {
    if (column === entity) continue;
    const raw = toPlainValue(value);

    const allowed = properties[column]?.enum;
    if (
      raw !== null &&
      allowed !== undefined &&
      !allowed.includes(String(raw))
    ) {
      return { ok: false, error: `"${String(raw)}" is not a valid ${column}.` };
    }

    fields[column] = raw;
  }

  // The tenancy guarantee: a reference must belong to this company, whatever
  // supplied it. Skipping it would let a workflow point at another tenant's row.
  for (const [column, raw] of Object.entries(fields)) {
    const type = action.inputs[column]?.type;
    if (type === undefined || type.kind !== "entity" || raw === null) continue;

    const belongs = await existsInCompany({
      client,
      entity: type.of,
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
      updatedAt: new Date().toISOString()
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
