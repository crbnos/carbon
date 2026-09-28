// Resolves the identifier a caller passed for an entity-keyed param to the
// record id the service filters on. The contract and the key table live in
// `mcp+/lib/identifier-keys.ts`; this is the one runtime lookup behind it.

import type { ManifestEntry } from "@carbon/api";
import type { Database } from "@carbon/database";
import { ORPCError } from "@orpc/server";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { IDENTIFIER_KEYS } from "../../mcp+/lib/identifier-keys";

export type IdentifierResolution =
  | { id: string; error?: undefined }
  | {
      id?: undefined;
      error:
        | { kind: "notFound"; message: string }
        | { kind: "ambiguous"; message: string }
        | { kind: "database"; error: PostgrestError };
    };

// The key table names tables dynamically, which the generated client types
// cannot follow; the queries below only touch `id`, `companyId` and the
// registered readable columns, all plain text columns.
type UntypedClient = {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string
      ): {
        eq(
          column: string,
          value: string
        ): {
          limit(count: number): PromiseLike<{
            data: { id: string }[] | null;
            error: PostgrestError | null;
          }>;
        };
      };
    };
  };
};

/**
 * The record id `value` names for `entity` within `companyId`: the record
 * whose `id` is `value`, else the one record any readable column names. Every
 * readable column is checked, so a value that names one record by one column
 * and others by another is refused rather than guessed: an item's bare
 * readable id equals the first revision's `readableIdWithRevision` and also
 * names every later revision. This is the refusal `resolveTypedItemRevision`
 * gives item writes.
 */
export async function resolveIdentifier(
  client: SupabaseClient<Database>,
  companyId: string,
  entity: string,
  value: string
): Promise<IdentifierResolution> {
  const key = IDENTIFIER_KEYS[entity];
  if (!key) throw new Error(`Unknown identifier entity: ${entity}`);
  const db = client as unknown as UntypedClient;
  const lookup = (column: string) =>
    db
      .from(key.table)
      .select("id")
      .eq(column, value)
      .eq("companyId", companyId)
      .limit(2);

  const byId = await lookup("id");
  if (byId.error) return { error: { kind: "database", error: byId.error } };
  if (byId.data && byId.data.length > 0) return { id: byId.data[0].id };

  const matches = new Set<string>();
  const matchedBy: string[] = [];
  for (const column of key.readable) {
    const { data, error } = await lookup(column);
    if (error) return { error: { kind: "database", error } };
    if (!data || data.length === 0) continue;
    matchedBy.push(column);
    for (const row of data) matches.add(row.id);
  }

  if (matches.size > 1) {
    return {
      error: {
        kind: "ambiguous",
        message: `${value} matches more than one ${entity} record by ${matchedBy.join(" or ")}; pass the record id (the \`id\` field) of the one you mean.`
      }
    };
  }
  const [id] = matches;
  if (id) return { id };

  const tried = ["id", ...key.readable].join(" or ");
  return {
    error: {
      kind: "notFound",
      message: `No ${entity} matches ${value} (looked up by ${tried}).`
    }
  };
}

/**
 * `args` with every entity-keyed param the manifest marks (`meta.keys`)
 * replaced by the record id it names. Params that are absent, null or empty
 * are left alone — the service decides what an omitted key means. Throws an
 * ORPCError the dispatch surfaces: NOT_FOUND / BAD_REQUEST for a caller
 * mistake, or BAD_REQUEST carrying `data.supabase` for a database failure so
 * it is reported like any other.
 */
export async function resolveIdentifierArgs<
  Args extends Record<string, unknown>
>(
  meta: Pick<ManifestEntry, "name" | "keys">,
  context: { client: SupabaseClient<Database>; companyId: string },
  args: Args | undefined
): Promise<Args | undefined> {
  if (!args || !meta.keys) return args;
  let resolved: Args | undefined;
  for (const [param, entity] of Object.entries(meta.keys)) {
    const value = args[param];
    if (typeof value !== "string" || value === "") continue;
    const result = await resolveIdentifier(
      context.client,
      context.companyId,
      entity,
      value
    );
    if (result.error) {
      if (result.error.kind === "database") {
        throw new ORPCError("BAD_REQUEST", {
          message: result.error.error.message,
          data: { supabase: result.error.error }
        });
      }
      throw new ORPCError(
        result.error.kind === "notFound" ? "NOT_FOUND" : "BAD_REQUEST",
        { message: `${meta.name}: ${result.error.message}` }
      );
    }
    if (result.id !== value) {
      resolved ??= { ...args };
      (resolved as Record<string, unknown>)[param] = result.id;
    }
  }
  return resolved ?? args;
}
