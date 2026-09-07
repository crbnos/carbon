import type { ConformanceCheck, Violation } from "../check";

// An RLS policy whose whole predicate is "is the caller signed in" scopes
// nothing. On a table with a companyId that is a cross-tenant hole, and on a
// permissive FOR ALL policy the USING clause doubles as the WITH CHECK, so it
// is a cross-tenant WRITE hole too — which is what left every company's
// eventSystemSubscription rows (webhook target URLs included) readable and
// writable by any authenticated user of any other company.
//
// Reference data genuinely shared across tenants (country, currencyCode,
// attributeDataType) matches this shape legitimately and is baselined.
const CREATE_POLICY =
  /CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:"public"\.)?"([^"]+)"/gi;

// `auth.role() = 'authenticated'` in any of its spellings, including the
// (SELECT auth.role()) form the RLS-performance refactor introduced.
const AUTHENTICATED_TEST =
  /\(?\s*(?:\(\s*SELECT\s+)?auth\.role\s*\(\s*\)\s*\)?\s*\)?\s*=\s*'authenticated'\s*\)?/gi;

/**
 * Blanks out `--` comments and '...' literals, preserving offsets and newlines
 * so reported line numbers still point at the real statement. Without this a
 * migration that QUOTES the policy it is replacing reports itself.
 */
function maskNoise(contents: string): string {
  const out = contents.split("");
  for (let i = 0; i < contents.length; i++) {
    if (contents[i] === "-" && contents[i + 1] === "-") {
      while (i < contents.length && contents[i] !== "\n") {
        out[i] = " ";
        i++;
      }
    } else if (contents[i] === "'") {
      // Keep the quotes so 'authenticated' still reads as a literal comparison;
      // only the interior of a LONG literal could hide a nested policy, and
      // 'authenticated' is short. Blanking quotes would break the test regex.
      const close = contents.indexOf("'", i + 1);
      if (close === -1) break;
      i = close;
    }
  }
  return out.join("");
}

/** Reads a balanced parenthesized group starting at `open`; -1 if unbalanced. */
function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * The USING / WITH CHECK bodies of one CREATE POLICY statement, read from
 * `start` up to the statement terminator.
 */
function policyPredicates(contents: string, start: number): string[] {
  const end = contents.indexOf(";", start);
  const statement = contents.slice(start, end === -1 ? contents.length : end);
  const bodies: string[] = [];

  for (const clause of [/\bUSING\s*\(/gi, /\bWITH\s+CHECK\s*\(/gi]) {
    for (const m of statement.matchAll(clause)) {
      const open = m.index + m[0].length - 1;
      const close = matchParen(statement, open);
      if (close === -1) continue;
      bodies.push(statement.slice(open + 1, close));
    }
  }

  return bodies;
}

export const noUntenantedRlsPolicy: ConformanceCheck = {
  id: "no-untenanted-rls-policy",
  description:
    "An RLS policy must scope rows, not just require a session — `auth.role() = 'authenticated'` alone is not a tenant predicate.",
  provenance: {
    deprecates:
      "RLS policies whose only predicate is auth.role() = 'authenticated'",
    replacedBy:
      "companyId = ANY (get_companies_with_employee_permission('<module>_<action>'))",
    since: "20260907152418_event-subscription-tenant-rls.sql"
  },
  scan(file: string, rawContents: string): Violation[] {
    const violations: Violation[] = [];
    const contents = maskNoise(rawContents);

    for (const m of contents.matchAll(CREATE_POLICY)) {
      const predicates = policyPredicates(contents, m.index);
      if (predicates.length === 0) continue;

      // ANY bare clause, not all of them: a FOR UPDATE policy whose USING is
      // scoped but whose WITH CHECK is bare still lets a caller move a row
      // into another company, which is the same bug from the other side.
      const anyBare = predicates.some((body) => {
        const remainder = body.replace(AUTHENTICATED_TEST, "");
        // Something was stripped (so the test is present) and nothing but
        // whitespace and parens is left (so nothing else was being checked).
        return remainder.length !== body.length && /^[\s()]*$/.test(remainder);
      });

      if (!anyBare) continue;

      const line = contents.slice(0, m.index).split("\n").length;
      violations.push({
        file,
        line,
        snippet: m[0].trim(),
        message: `Policy "${m[1]}" on "${m[2]}" only checks that the caller is authenticated — add a tenant predicate (see .claude/rules/conventions-database.md).`
      });
    }

    return violations;
  }
};
