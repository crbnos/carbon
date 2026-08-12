import type { Database } from "@carbon/database";
import {
  entityValue,
  isNull,
  listValue,
  MAX_LIST_ITEMS,
  nullValue,
  REGISTRY_ENTRIES,
  type RuntimeValue,
  type SearchCriterion,
  type SearchOutcome,
  WORKFLOW_ENTITIES
} from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The scalar a criterion filters by; a list has no single value to compare. */
function scalarOf(value: RuntimeValue): string | number | boolean | undefined {
  if (value.kind === "entity") return value.id;
  if (value.kind === "list" || value.kind === "pairs") return undefined;
  return value.value === null ? undefined : value.value;
}

/**
 * The columns the catalog declares for this entity, and nothing else.
 *
 * The row rides along on the entity value and lands in `workflowStepRun.output`,
 * kept for 30 days — so `select("*")` would be both a payload-size problem on wide
 * tables and a data-minimisation one on `supplier`, `user` and `salesOrder`. A
 * dot-path can only reach a declared property anyway. `id` is forced in because
 * the row is keyed by it.
 */
function selectedColumns(entity: string): string | undefined {
  const properties = WORKFLOW_ENTITIES[entity];
  if (properties === undefined) return undefined;
  const columns = Object.keys(properties);
  if (columns.length === 0) return undefined;
  return columns.includes("id")
    ? columns.join(", ")
    : ["id", ...columns].join(", ");
}

function foundNothing(entity: string, returns: "one" | "list"): SearchOutcome {
  const value =
    returns === "one"
      ? nullValue()
      : listValue({ kind: "entity", of: entity }, []).value;
  return { ok: true, value, matched: 0, dropped: 0 };
}

/** Runs one Lookup node's search as the workflow's owner. Operators mean exactly
 * what `runtime/compare.ts` says they mean, so the two can never disagree. */
export async function runSearch(params: {
  client: SupabaseClient<Database>;
  companyId: string;
  entity: string;
  returns: "one" | "list";
  criteria: SearchCriterion[];
}): Promise<SearchOutcome> {
  const { client, companyId, entity, returns, criteria } = params;

  const table = REGISTRY_ENTRIES[entity]?.table;
  const columns = selectedColumns(entity);
  if (table === undefined || columns === undefined) {
    return { ok: false, error: `We no longer know what a ${entity} is.` };
  }

  // The entity is only known at run time; typing it costs a 350-way instantiation.
  const untyped = client as unknown as SupabaseClient;
  // Row-level security already scopes this read; the filter is the second lock.
  let query = untyped.from(table).select(columns).eq("companyId", companyId);

  for (const criterion of criteria) {
    const { field, operator, value } = criterion;

    // Checked at publish time too (definition/nodes.ts). Repeated here because a
    // field name goes straight into a PostgREST filter, and a definition saved
    // before a catalog change was validated against a catalog that no longer exists.
    if (!(field in (WORKFLOW_ENTITIES[entity] ?? {}))) {
      return {
        ok: false,
        error: `We cannot search a ${entity} by "${field}".`
      };
    }

    if (isNull(value)) {
      // Nothing is only ever equal or unequal to nothing; it is never ordered.
      if (operator === "eq") {
        query = query.is(field, null);
        continue;
      }
      if (operator === "neq") {
        query = query.not(field, "is", null);
        continue;
      }
      return foundNothing(entity, returns);
    }

    const scalar = scalarOf(value);
    if (scalar === undefined) {
      return {
        ok: false,
        error: `We cannot search "${field}" for that kind of value.`
      };
    }

    switch (operator) {
      case "eq":
        query = query.eq(field, scalar);
        break;
      case "neq":
        query = query.neq(field, scalar);
        break;
      case "gt":
        query = query.gt(field, scalar);
        break;
      case "gte":
        query = query.gte(field, scalar);
        break;
      case "lt":
        query = query.lt(field, scalar);
        break;
      case "lte":
        query = query.lte(field, scalar);
        break;
      // ilike, because these three ignore case and eq/neq do not.
      case "contains":
        query = query.ilike(field, `%${scalar}%`);
        break;
      case "startsWith":
        query = query.ilike(field, `${scalar}%`);
        break;
      case "endsWith":
        query = query.ilike(field, `%${scalar}`);
        break;
      default:
        return {
          ok: false,
          error: `We cannot search by "${operator}".`
        };
    }
  }

  // Newest first makes "the one" deterministic; one over the cap makes an
  // over-cap list detectable.
  const { data, error } = await query
    .order("createdAt", { ascending: false })
    .limit(MAX_LIST_ITEMS + 1);

  if (error) return { ok: false, error: error.message };

  // A run-time column list makes PostgREST's return type unresolvable.
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const found: RuntimeValue[] = [];
  for (const row of rows) {
    // The row rides along, so a later dot-path costs no second read.
    if (typeof row.id === "string")
      found.push(entityValue(entity, row.id, row));
  }

  if (returns === "one") {
    const first = found[0];
    if (first === undefined) return foundNothing(entity, returns);
    return { ok: true, value: first, matched: 1, dropped: found.length - 1 };
  }

  const capped = listValue({ kind: "entity", of: entity }, found);
  return {
    ok: true,
    value: capped.value,
    matched: found.length - capped.dropped,
    dropped: capped.dropped
  };
}
