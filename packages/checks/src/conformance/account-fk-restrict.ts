// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

/** The migration that made every foreign key to `account` RESTRICT. Older ones are history. */
const SINCE = "20261013005642";

export const ACCOUNT_REFERENCE_POLICY_FILE =
  "packages/database/src/account-import.ts";

const IDENT = String.raw`(?:"[^"]+"|\w+)`;

/**
 * `REFERENCES account`, then its optional column list, then the rest of the
 * constraint up to the next `,` `;` `(` or `)`. Postgres puts the actions
 * straight after the column list, so that span holds `ON DELETE` when there is
 * one. The lookahead keeps `"accountDefault"` and `accountingPeriod` out; a
 * quoted name of another case is filtered after the match, because `i` also
 * folds the quoted form and only the unquoted one folds in Postgres.
 */
const ACCOUNT_REFERENCE = new RegExp(
  String.raw`\bREFERENCES\s+(?:(?:"public"|public)\s*\.\s*)?("account"|account)(?![\w"$])\s*(?:\([^)]*\))?([^,;()]*)`,
  "gi"
);

const ON_DELETE_RESTRICT = /\bON\s+DELETE\s+RESTRICT\b/i;

const TABLE_HEADER = new RegExp(
  String.raw`\b(?:CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?|ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?)(?:${IDENT}\s*\.\s*)?(${IDENT})`,
  "gi"
);

const TABLE_CONSTRAINT_COLUMNS = /\bFOREIGN\s+KEY\s*\(\s*([^)]*)\)\s*$/i;

/**
 * A column definition ending where `REFERENCES` starts: name, type (several
 * words, an optional modifier and array marker), and the constraints that may
 * come before the foreign key. The name may not be a keyword, or
 * `, ADD COLUMN "x"` would read `ADD` as the column.
 */
const INLINE_COLUMN = new RegExp(
  String.raw`(?:[,(]|\bADD(?:\s+COLUMN)?(?:\s+IF\s+NOT\s+EXISTS)?)\s*(?!(?:ADD|COLUMN|IF|CONSTRAINT|FOREIGN|PRIMARY|UNIQUE|CHECK)\b)(${IDENT})\s+${IDENT}(?:\s+${IDENT})*?(?:\s*\([^)]*\))?(?:\s*\[\])?(?:\s+(?:NOT\s+NULL|NULL|DEFAULT\s+(?:'[^']*'|[\w.]+(?:\(\))?)|CONSTRAINT\s+${IDENT}))*\s*$`,
  "i"
);

/** Postgres folds an unquoted identifier to lower case. */
function unquote(identifier: string): string {
  return identifier.startsWith('"')
    ? identifier.slice(1, -1)
    : identifier.toLowerCase();
}

/** Keeps every newline, so line numbers stay right. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
}

/**
 * Undefined for a statement this cannot read (dynamic SQL, an unusual column
 * type); the apply-account-import live test covers those.
 */
function referencingColumn(sql: string, at: number): string | undefined {
  const statement = sql.slice(sql.lastIndexOf(";", at) + 1, at);
  const header = [...statement.matchAll(TABLE_HEADER)].at(-1);
  if (!header?.[1] || header.index === undefined) return undefined;
  const definition = statement.slice(header.index + header[0].length);
  const column =
    TABLE_CONSTRAINT_COLUMNS.exec(definition)?.[1]?.split(",")[0]?.trim() ??
    INLINE_COLUMN.exec(definition)?.[1];
  if (!column) return undefined;
  return `${unquote(header[1])}.${unquote(column)}`;
}

export type AccountReferencePolicy = {
  /** `table.column` pairs REFERENCE_POLICY lists. */
  classified: ReadonlySet<string>;
  /** UNCLASSIFIED_ACCOUNT_REFERENCES: each a table or a `table.column`. */
  unclassified: readonly string[];
};

function exportedArray(source: string, name: string): string {
  const start = source.indexOf(`export const ${name}`);
  const end = source.indexOf("\n];", start);
  if (start === -1 || end === -1) {
    throw new Error(
      `${name} not found in ${ACCOUNT_REFERENCE_POLICY_FILE}; update account-fk-classified to read where it moved.`
    );
  }
  return source.slice(start, end);
}

/**
 * Read from the source of `account-import.ts` so this package does not depend
 * on `@carbon/database`.
 */
export function parseReferencePolicy(source: string): AccountReferencePolicy {
  const classified = new Set(
    [
      ...exportedArray(source, "REFERENCE_POLICY").matchAll(
        /\btable:\s*"([^"]+)",\s*column:\s*"([^"]+)"/g
      )
    ].map(([, table, column]) => `${table}.${column}`)
  );
  const unclassified = [
    ...exportedArray(source, "UNCLASSIFIED_ACCOUNT_REFERENCES").matchAll(
      /"([^"]+)"/g
    )
  ].map(([, ref]) => ref as string);
  return { classified, unclassified };
}

type AccountReference = {
  line: number;
  snippet: string;
  clause: string;
  ref: string | undefined;
};

function accountReferences(file: string, contents: string): AccountReference[] {
  if (file < SINCE) return [];
  const sql = stripComments(contents);
  return [...sql.matchAll(ACCOUNT_REFERENCE)].flatMap((m) => {
    const [whole, table = "", clause = ""] = m;
    if (table.startsWith('"') && table !== '"account"') return [];
    const at = m.index;
    return [
      {
        line: sql.slice(0, at).split("\n").length,
        snippet: sql
          .slice(sql.lastIndexOf("\n", at) + 1, at + whole.length)
          .trim()
          .replace(/\s+/g, " "),
        clause,
        ref: referencingColumn(sql, at)
      }
    ];
  });
}

const provenance = {
  deprecates: 'REFERENCES "account"("id") ON DELETE SET NULL',
  replacedBy: 'REFERENCES "account"("id") ON DELETE RESTRICT',
  since: "20261013005642_account-delete-restrict.sql",
  incidents: ["a3c398b5f9"]
};

export const accountFkRestrict: ConformanceCheck = {
  id: "account-fk-restrict",
  description: "A foreign key to account must be ON DELETE RESTRICT.",
  provenance,
  scan(file, contents) {
    return accountReferences(file, contents)
      .filter(({ clause }) => !ON_DELETE_RESTRICT.test(clause))
      .map(({ line, snippet }) => ({
        file,
        line,
        snippet,
        message:
          "A foreign key to account must be ON DELETE RESTRICT: SET NULL lets a deleted account silently empty Draft and Provisional lines, and no ON DELETE leaves the choice unstated. Add ON DELETE RESTRICT, and classify the column in REFERENCE_POLICY (packages/database/src/account-import.ts)."
      }));
  }
};

/**
 * The apply-account-import live test checks the catalog; this catches a
 * missing class without a database.
 */
export function accountFkClassified({
  classified,
  unclassified
}: AccountReferencePolicy): ConformanceCheck {
  return {
    id: "account-fk-classified",
    description:
      "A column with a foreign key to account must be classified in REFERENCE_POLICY.",
    provenance,
    scan(file, contents) {
      const violations: Violation[] = [];
      for (const { line, snippet, ref } of accountReferences(file, contents)) {
        if (
          !ref ||
          classified.has(ref) ||
          unclassified.some((u) => ref === u || ref.startsWith(`${u}.`))
        ) {
          continue;
        }
        violations.push({
          file,
          line,
          snippet,
          message: `${ref} names an account but is not in REFERENCE_POLICY (packages/database/src/account-import.ts), so the chart of accounts import cannot tell whether a merge may move it. Classify it: repoint, repoint-if-status, repoint-if-parent-status or history.`
        });
      }
      return violations;
    }
  };
}
