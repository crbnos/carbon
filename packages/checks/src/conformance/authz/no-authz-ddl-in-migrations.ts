// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Node } from "libpg-query";
import { defineCheck, eachFile, type Violation } from "../../check";
import { migrations } from "../../sources/inputs";
import {
  ATTACHMENTS_SINCE,
  loadManagedFunctions,
  MANIFEST_SINCE
} from "../../sources/managed-functions";
import { GENERATED_AUTHZ_MIGRATION } from "../../sources/migrations";
import { nameParts, sqlNodes } from "../../sources/sql";

// RLS policies and the managed functions are authored only as files — the manifest and
// packages/database/src/authz/helpers/<name>.sql for RLS, and
// packages/database/src/event-system/functions/<name>.sql for the event system — and
// `authz sync` applies them after migrations. A migration that creates or alters a policy,
// or defines, alters or drops a managed function, would be silently overwritten at the next
// sync — or reintroduce exactly the drift the files exist to stop (a redefinition once
// turned get_companies_with_employee_permission from STABLE back to VOLATILE; a fork of
// create_audit_log_table made every audit write run DDL).
//
// `DROP POLICY` stays allowed: dropping a column a policy uses needs the policy gone
// first, and the next sync recreates the table's policies from the manifest.
//
// Only migrations after a set was taken over are checked; older ones are history.
export const noAuthzDdlInMigrations = defineCheck({
  id: "no-authz-ddl-in-migrations",
  description:
    "Policies, RLS helpers, event-system functions and event triggers are authored as files, not migrations.",
  provenance: {
    deprecates: "CREATE/ALTER POLICY and managed function DDL in migrations",
    replacedBy:
      "packages/database/src/authz (manifest.ts + helpers/*.sql) and packages/database/src/event-system/functions/*.sql",
    since: MANIFEST_SINCE
  },
  reads: { files: migrations, functions: loadManagedFunctions },
  rule() {
    // Each of these replaces a table's whole list of handlers, so a call that
    // leaves one out detaches it. The lists live in one place instead:
    // packages/database/src/event-system/attachments.ts.
    const attachCalls = new Set([
      "attach_event_trigger",
      "attach_statement_handler",
      "set_event_triggers"
    ]);

    // The manifest owns public tables and realtime.messages (broadcast authorization);
    // storage.objects (bucket) policies stay in migrations.
    const manifestSchemas = new Set(["public", "realtime"]);

    /** The function a statement defines, alters or drops, as `[schema, name]` parts. */
    const functionsTouched = (
      node: Node
    ): { verb: string; parts: string[] }[] => {
      if ("CreateFunctionStmt" in node) {
        const parts = nameParts(node.CreateFunctionStmt.funcname);
        return [{ verb: "CREATE FUNCTION", parts }];
      }
      if ("AlterFunctionStmt" in node) {
        const parts = nameParts(node.AlterFunctionStmt.func?.objname);
        return [{ verb: "ALTER FUNCTION", parts }];
      }
      const altered =
        "AlterOwnerStmt" in node &&
        node.AlterOwnerStmt.objectType === "OBJECT_FUNCTION"
          ? node.AlterOwnerStmt.object
          : "RenameStmt" in node &&
              node.RenameStmt.renameType === "OBJECT_FUNCTION"
            ? node.RenameStmt.object
            : "AlterObjectSchemaStmt" in node &&
                node.AlterObjectSchemaStmt.objectType === "OBJECT_FUNCTION"
              ? node.AlterObjectSchemaStmt.object
              : undefined;
      if (altered && "ObjectWithArgs" in altered) {
        const parts = nameParts(altered.ObjectWithArgs.objname);
        return [{ verb: "ALTER FUNCTION", parts }];
      }
      if (
        "DropStmt" in node &&
        node.DropStmt.removeType === "OBJECT_FUNCTION"
      ) {
        return (node.DropStmt.objects ?? []).flatMap((object) =>
          "ObjectWithArgs" in object
            ? [
                {
                  verb: "DROP FUNCTION",
                  parts: nameParts(object.ObjectWithArgs.objname)
                }
              ]
            : []
        );
      }
      return [];
    };

    return ({ files, functions }) => {
      const managed = new Map(
        functions.map((f) => [`${f.schema}.${f.name}`.toLowerCase(), f])
      );
      return eachFile(files, (file, contents) => {
        const timestamp = /^(\d{14})_/.exec(file)?.[1];
        if (
          !timestamp ||
          timestamp < MANIFEST_SINCE ||
          contents.startsWith(GENERATED_AUTHZ_MIGRATION)
        )
          return [];

        const violations: Violation[] = [];
        for (const { node, line } of sqlNodes(contents)) {
          const policy =
            "CreatePolicyStmt" in node
              ? { verb: "CREATE", ...node.CreatePolicyStmt }
              : "AlterPolicyStmt" in node
                ? { verb: "ALTER", ...node.AlterPolicyStmt }
                : undefined;
          if (
            policy &&
            manifestSchemas.has(policy.table?.schemaname ?? "public")
          ) {
            violations.push({
              file,
              line,
              snippet: `${policy.verb} POLICY "${policy.policy_name}" ON "${policy.table?.relname}"`,
              message:
                "Author policies in packages/database/src/authz/manifest.ts, then run `pnpm --filter @carbon/database authz migration <name>`."
            });
          }

          if ("FuncCall" in node && timestamp >= ATTACHMENTS_SINCE) {
            const called = nameParts(node.FuncCall.funcname).at(-1) ?? "";
            if (attachCalls.has(called)) {
              violations.push({
                file,
                line,
                snippet: `${called}(`,
                message:
                  "Declare event triggers in packages/database/src/event-system/attachments.ts, then run `pnpm --filter @carbon/database authz migration <name>`."
              });
            }
          }

          for (const { verb, parts } of functionsTouched(node)) {
            const name = parts.at(-1) ?? "";
            const schema = parts.length > 1 ? parts[0] : "public";
            const fn = managed.get(`${schema}.${name}`.toLowerCase());
            if (!fn || timestamp < fn.since) continue;
            violations.push({
              file,
              line,
              snippet: `${verb} ${name}`,
              message: `${name} is a managed function; edit ${fn.file}, then run \`pnpm --filter @carbon/database authz migration <name>\`.`
            });
          }
        }
        return violations;
      });
    };
  }
});
