// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Node, RangeVar } from "libpg-query";
import { fileCheck, type Violation } from "../check";
import { migrations } from "../sources/inputs";
import { sqlNodes } from "../sources/sql";

// Every view in "public" is a PostgREST endpoint reachable with the anon key the
// apps publish. Without `security_invoker` a view runs as its owner and the RLS
// on the tables underneath never sees the caller: `openJobMaterialLines`
// served every company's rows to anyone for months, after four migrations
// recreated it from a copy that lacked the clause.
//
// Any `security_invoker` option passes, `security_invoker = false` included:
// the rule is that a view states how it runs, so an owner-rights view is a
// visible decision rather than an omission. A materialized view is not a
// `CREATE VIEW` statement and cannot run as its caller at all (it must have
// SELECT revoked from anon and authenticated instead).
//
// `CREATE OR REPLACE VIEW` replaces the view's options too, so a redefinition
// that leaves out the clause turns an invoker view back into an owner-rights
// view. Every redefinition must state it again.
//
// The check reads the parsed statements, so it sees a view created in a DO
// block or in an `EXECUTE` of a plain string. A view built by
// `EXECUTE format(...)` still escapes it. The invariant
// `src/invariants/view-without-security-invoker.sql` is the backstop: it reads
// the live catalog, whatever created the view.

function namesInvoker(options: Node[] | undefined): boolean {
  return (options ?? []).some(
    (option) =>
      "DefElem" in option && option.DefElem.defname === "security_invoker"
  );
}

function quoted(view: RangeVar | undefined): string {
  return [view?.schemaname, view?.relname]
    .filter((part) => part !== undefined)
    .map((part) => `"${part}"`)
    .join(".");
}

export const noViewWithoutInvoker = fileCheck(migrations, {
  id: "no-view-without-invoker",
  description:
    "A view must state security_invoker, or it runs as its owner and bypasses RLS.",
  provenance: {
    deprecates: 'CREATE OR REPLACE VIEW "x" AS',
    replacedBy: 'CREATE OR REPLACE VIEW "x" WITH (security_invoker = true) AS',
    since: "20260926093417_open-job-material-lines-invoker.sql"
  },
  scan(file, contents) {
    const violations: Violation[] = [];
    for (const { node, fragment } of sqlNodes(contents)) {
      if ("ViewStmt" in node) {
        const { view, options } = node.ViewStmt;
        if (namesInvoker(options)) continue;
        violations.push({
          file,
          line: fragment.lineAt(view?.location),
          snippet: `CREATE VIEW ${quoted(view)}`,
          message: `View ${quoted(view)} has no security_invoker, so it runs as its owner: the RLS on the tables underneath never applies, and PostgREST serves every company's rows to anyone holding the anon key. Add WITH (security_invoker = true).`
        });
      }
      // `ALTER VIEW … RESET (security_invoker)` puts a view back on the
      // owner-rights default as silently as recreating it without the clause.
      if (
        "AlterTableStmt" in node &&
        node.AlterTableStmt.objtype === "OBJECT_VIEW"
      ) {
        const { relation, cmds } = node.AlterTableStmt;
        for (const cmd of cmds ?? []) {
          if (!("AlterTableCmd" in cmd)) continue;
          const { subtype, def } = cmd.AlterTableCmd;
          if (subtype !== "AT_ResetRelOptions" || !def || !("List" in def)) {
            continue;
          }
          if (!namesInvoker(def.List.items)) continue;
          violations.push({
            file,
            line: fragment.lineAt(relation?.location),
            snippet: `ALTER VIEW ${quoted(relation)} RESET (security_invoker)`,
            message: `RESET (security_invoker) puts view ${quoted(relation)} back on owner rights, bypassing RLS for every PostgREST caller. Use SET (security_invoker = true), or state security_invoker = false if owner rights are intended.`
          });
        }
      }
    }
    return violations;
  }
});
