// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CallExpression, StaticMemberExpression } from "oxc-parser";
import { defineCheck, eachFile, type Violation } from "../../check";
import { loadDbTableColumns } from "../../sources/db-columns";
import { typescript } from "../../sources/inputs";
import {
  childrenOf,
  isNamedMember,
  type Node,
  parseTypescript,
  walk
} from "../../sources/syntax";
import { lineOf } from "../../sources/text";

// A write must not name `createdBy` / `updatedBy` on a table that has no such
// column. PostgREST rejects the whole statement with
// `PGRST204 Could not find the 'createdBy' column of '<table>' in the schema
// cache`, and TypeScript does not catch it — supabase-js widens the
// insert/upsert argument enough that the excess property survives, which is how
// `sales-rfq.$rfqId.map-lines.ts` shipped an upsert on `customerPartToItem`
// (six columns, none of them audit) whose result was never checked, so every
// RFQ-line → customer-part mapping silently failed.
//
// Roughly a third of Carbon's tables have no audit columns — favourites, link
// tables, the lean material lookups, `companySettings` — while the convention
// (`conventions-index.md` golden rule 3) says to include them, so this is an
// easy assumption to carry into the wrong table.
//
// Scope is the KEYS of the literal row object(s) in the write's FIRST argument.
// A payload object spread into the row (`insert([row])`) can carry the same bad
// key, but only the caller knows what is in it.
//
// Both halves of the match read the parsed TypeScript, because the textual
// version of each produced false findings and this check gates commits through
// `collectFindings`:
//
//  - The write must sit in the matched target's OWN call chain
//    (`.from("t")…insert(row)`). A character window picked up the NEXT
//    statement's write instead, so
//    `from("link").select("id"); from("item").insert({ createdBy })` reported
//    `createdBy` against `link`.
//  - A name must be a property KEY of a row object. Matching the bare name
//    anywhere flagged an identifier used as a value
//    (`update({ name: createdBy })`), flagged the keys of nested value objects,
//    and missed a quoted key (`{ "createdBy": userId }`) entirely.
//
// The one site it found was fixed when the check landed, so any finding is
// new.
export const noMissingAuditColumn = defineCheck({
  id: "no-missing-audit-column",
  description:
    "A write never names createdBy/updatedBy on a table that has no such column — PostgREST rejects the statement with PGRST204 and TypeScript does not catch it.",
  provenance: {
    deprecates:
      "stamping createdBy/updatedBy on a table without audit columns (the customerPartToItem upsert in sales-rfq.$rfqId.map-lines.ts, which failed every call)",
    replacedBy: "writing only the columns the table has",
    since: "PGRST204 on items_upsertItemCustomerPart"
  },
  reads: { files: typescript, columns: loadDbTableColumns },
  rule() {
    const auditFields = ["createdBy", "updatedBy"];

    /** A file the check can report on: it names a target and an audit field. */
    const auditTarget =
      /(?:\.from|insertInto|updateTable)\(\s*["'`]\w+["'`]\s*\)/;
    const auditField = /\b(?:createdBy|updatedBy)\b/;

    /** Chain members whose first argument carries the row(s). */
    const writeVerbs = new Set(["insert", "upsert", "update", "values", "set"]);

    /** The text of `"t"` or `` `t` ``; undefined for any other node. */
    function literalText(node: Node): string | undefined {
      if (node.type === "Literal" && typeof node.value === "string") {
        return node.value;
      }
      if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
        return node.quasis[0]?.value.cooked ?? undefined;
      }
      return undefined;
    }

    /** The table of `.from("t")`, `insertInto("t")` or `updateTable("t")`. */
    function targetTable(node: Node): string | undefined {
      if (node.type !== "CallExpression" || node.arguments.length !== 1) return;
      const callee = node.callee;
      const name = isNamedMember(callee)
        ? callee.property.name
        : callee.type === "Identifier"
          ? callee.name
          : "";
      const isTarget =
        name === "insertInto" ||
        name === "updateTable" ||
        (name === "from" && isNamedMember(callee));
      const [table] = node.arguments;
      const text = table ? literalText(table) : undefined;
      if (!isTarget || text === undefined) return;
      return /^\w+$/.test(text) ? text : undefined;
    }

    /**
     * The table a write call (`….insert(row)`) writes, when its own chain starts
     * at a target. The chain is walked back through `.member` and `.member(…)`;
     * anything else (`?.`, a cast, an index) ends it, and so does an earlier write
     * call, which is the one the target's row belongs to.
     */
    function writtenTable(write: CallExpression): string | undefined {
      if (!isNamedMember(write.callee)) return;
      if (!writeVerbs.has(write.callee.property.name)) return;
      let access: StaticMemberExpression = write.callee;
      for (;;) {
        if (access.optional) return;
        const link = access.object;
        if (isNamedMember(link)) {
          access = link;
          continue;
        }
        const table = targetTable(link);
        if (table) return table;
        if (link.type !== "CallExpression") return;
        if (!isNamedMember(link.callee)) return;
        if (writeVerbs.has(link.callee.property.name)) return;
        access = link.callee;
      }
    }

    type RowKey = { name: string; start: number };

    /**
     * The keys of the row objects in a write's FIRST argument. A ROW object is an
     * object literal with no enclosing object literal, so `insert({…})` and
     * `insert([{…}, {…}])` both yield rows while a nested value object does not.
     * Shorthand, `key:` and `"key":` forms all count; a computed `[key]:`, a
     * method and an accessor do not.
     */
    function rowKeys(node: Node, keys: RowKey[] = []): RowKey[] {
      if (node.type === "ObjectExpression") {
        for (const property of node.properties) {
          if (
            property.type !== "Property" ||
            property.computed ||
            property.method ||
            property.kind !== "init"
          ) {
            continue;
          }
          const { key } = property;
          if (key.type === "Identifier") {
            keys.push({ name: key.name, start: key.start });
          } else if (key.type === "Literal" && typeof key.value === "string") {
            keys.push({ name: key.value, start: key.start });
          }
        }
        return keys;
      }
      for (const child of childrenOf(node)) rowKeys(child, keys);
      return keys;
    }

    return ({ files, columns }) =>
      eachFile(files, (file, contents) => {
        if (!auditTarget.test(contents) || !auditField.test(contents)) {
          return [];
        }
        const { program } = parseTypescript(file, contents);
        const violations: Violation[] = [];
        walk(program, (node) => {
          if (node.type !== "CallExpression") return;
          const table = writtenTable(node);
          const present = table ? columns.get(table) : undefined;
          const [row] = node.arguments;
          if (!present || !row) return;
          for (const key of rowKeys(row)) {
            if (!auditFields.includes(key.name) || present.has(key.name)) {
              continue;
            }
            violations.push({
              file,
              line: lineOf(contents, key.start),
              snippet: key.name,
              message: `"${table}" has no "${key.name}" column — this write fails with PGRST204 (and TypeScript will not flag it). Remove the field.`
            });
          }
        });
        return violations;
      });
  }
});
