import type { ConformanceCheck, Violation } from "../check";
import { blankComments } from "./no-unscoped-kysely-write";
import {
  chainCalls,
  enclosingFunction,
  isErpServiceFile,
  lineAt,
  literalFirstArg,
  statementFrom
} from "./supabase-chain";

/**
 * A supabase-js `.update(` / `.delete(` keyed on a row's unique key must end
 * in `.single()`.
 *
 * PostgREST answers a PATCH or DELETE that matches no row with 204, and
 * supabase-js turns that into `{ data: null, error: null }`. The service hands
 * that object back, the route and the API/MCP dispatcher see no error, and the
 * caller is told the write succeeded when nothing changed: a wrong id, a
 * readable id where the key is a uuid, a row RLS hides, or a status guard
 * (`.eq("status", "Draft")`) that no longer holds all look like success.
 * `.select("id").single()` makes the miss an error: PostgREST returns PGRST116,
 * which the API maps to "no matching record was found" and the UI shows as the
 * failure it already flashes for `result.error`.
 *
 * Only single-key writes are in scope. `.single()` on a write that matches
 * more than one row makes PostgREST roll the statement back, so a delete keyed
 * on a parent id (`.eq("quoteId", id)`) or an `.in(...)` list must NOT gain
 * it; those stay as they are. `.select("id")` without `.single()` does not
 * pass: a miss then returns `data: []` with no error, the same silent success.
 * `.maybeSingle()` does not pass either, for the same reason.
 *
 * A write is single-key when every column of the table's unique key has an
 * `.eq(column, …)` in the statement. The key is `id` unless `UNIQUE_KEYS`
 * names another (primary keys that are not a globally unique `id`). Chains
 * split across variables, and tables named by a variable, are not seen.
 */

const MESSAGE =
  'A write keyed on a unique key resolves { data: null, error: null } when no row matches, so callers are told it succeeded. End the chain with .select("id").single() (pre-read and return ruleError(...) for a status guard).';

/**
 * Tables whose primary key is not a globally unique `id`. Tables keyed
 * `(companyId, id)` whose `id` is a readable or caller-chosen value (the
 * item-type tables, accounts, integrations) need `companyId` too; composite
 * keys without `id` list every column.
 */
export const UNIQUE_KEYS: Record<string, string[]> = {
  accountDefault: ["companyId"],
  companyIntegration: ["companyId", "id"],
  consumable: ["companyId", "id"],
  customerAccount: ["companyId", "id"],
  customerPayment: ["customerId"],
  customerShipping: ["customerId"],
  customerTax: ["customerId"],
  employee: ["companyId", "id"],
  employeeJob: ["companyId", "id"],
  fiscalYearSettings: ["companyId"],
  fixture: ["companyId", "id"],
  itemReplenishment: ["itemId"],
  itemShelfLife: ["itemId"],
  itemSupersession: ["itemId"],
  material: ["companyId", "id"],
  part: ["companyId", "id"],
  partner: ["abilityId", "id"],
  quoteLinePrice: ["quoteLineId", "quantity"],
  sequence: ["companyId", "table"],
  service: ["companyId", "id"],
  supplierAccount: ["companyId", "id"],
  supplierPartPrice: ["supplierPartId", "quantity"],
  supplierPayment: ["supplierId"],
  supplierQuoteLinePrice: ["supplierQuoteLineId", "quantity"],
  supplierShipping: ["supplierId"],
  supplierTax: ["supplierId"],
  tool: ["companyId", "id"],
  userToCompany: ["companyId", "userId"]
};

const FROM = /\.from\s*\(\s*(["'`])([\w$]+)\1\s*\)/g;

export function uniqueKeyOf(table: string): string[] {
  return UNIQUE_KEYS[table] ?? ["id"];
}

/**
 * The variable a chain is assigned to (`const x = await client.from(…)` /
 * `let query = client.from(…)`), or null when it is returned or discarded.
 */
function assignedName(text: string, fromOffset: number): string | null {
  const before = text.slice(Math.max(0, fromOffset - 200), fromOffset);
  const m =
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?[\w$.()\s]*$/.exec(
      before
    );
  return m ? m[1]! : null;
}

/** Text from `offset` to the end of the enclosing top-level function. */
function restOfFunction(text: string, offset: number): string {
  const end = text.slice(offset).search(/\n}\s*\n/);
  return end === -1 ? text.slice(offset) : text.slice(offset, offset + end);
}

/**
 * A chain built across statements (`let query = client.from(t).update(x)
 * .eq("id", id); if (c) query = query.eq(…); return query.select("id")
 * .single();`) passes when a later statement continues the variable into
 * `.single()`.
 */
function continuesToSingle(rest: string, name: string): boolean {
  const use = new RegExp(`\\b${name}\\s*\\.\\s*(?!data\\b|error\\b)`, "g");
  for (const m of rest.matchAll(use)) {
    const calls = chainCalls(statementFrom(rest, m.index ?? 0));
    if (calls.some((c) => c.name === "single")) return true;
  }
  return false;
}

/**
 * `.maybeSingle()` resolves `data: null` on a miss; it passes only when the
 * caller then tests for that (`if (!result.data)`), the optimistic-status
 * pattern in updateChangeNoticeStatus.
 */
function checksMissingRow(rest: string, name: string): boolean {
  return new RegExp(
    `!\\s*${name}\\??\\.data\\b|\\b${name}\\??\\.data\\s*===?\\s*null`
  ).test(rest);
}

export const noUnconfirmedWrite: ConformanceCheck = {
  id: "no-unconfirmed-write",
  description:
    "A supabase-js update/delete keyed on a unique key in an ERP service ends in .single(), so a write that matched no row is an error instead of a silent success.",
  provenance: {
    deprecates:
      'client.from(t).delete().eq("id", id) / .update(x).eq("id", id) resolving { data: null, error: null } on a miss (wrong id, readable id, failed status guard)',
    replacedBy:
      '.select("id").single() on single-key writes (PGRST116 -> notFound); status guards pre-read and return ruleError(...)'
  },
  scan(file, contents) {
    if (!isErpServiceFile(file)) return [];
    if (!contents.includes(".update(") && !contents.includes(".delete(")) {
      return [];
    }
    const text = blankComments(contents);
    const violations: Violation[] = [];
    for (const m of text.matchAll(FROM)) {
      const start = m.index ?? 0;
      const table = m[2]!;
      const calls = chainCalls(statementFrom(text, start));
      const op = calls[1]?.name;
      if (op !== "update" && op !== "delete") continue;

      const eqColumns = new Set(
        calls
          .filter((c) => c.name === "eq")
          .map((c) => literalFirstArg(c.args))
          .filter((c): c is string => c !== null)
      );
      if (!uniqueKeyOf(table).every((column) => eqColumns.has(column))) {
        continue;
      }
      if (calls.some((c) => c.name === "single")) continue;
      const assigned = assignedName(text, start);
      if (assigned) {
        const rest = restOfFunction(text, start);
        if (continuesToSingle(rest, assigned)) continue;
        if (
          calls.some((c) => c.name === "maybeSingle") &&
          checksMissingRow(rest, assigned)
        ) {
          continue;
        }
      }

      violations.push({
        file,
        line: lineAt(text, start),
        snippet: `${enclosingFunction(text, start)}: from("${table}").${op}()`,
        message: MESSAGE
      });
    }
    return violations;
  }
};
