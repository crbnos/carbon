import type { ConformanceCheck, Violation } from "../check";

/**
 * An ERP route action (`apps/erp/app/routes/x+/**`) must not write a table
 * itself. A write that lives only in a route is invisible to every other
 * caller: the MCP server, the in-app agent, workflows and the HTTP API publish
 * the module's service and `{module}.mcp.server.ts` functions, so an operation
 * whose write (or whose follow-up price recalculation, status derivation, MRP
 * run or guard) sits in the route has no equivalent there — or has a bare
 * primitive that "succeeds" without it. Supplier part price breaks, the item
 * Active toggle and the sales order confirm were all route-only writes.
 *
 * The seam: put the write — and the steps that must accompany it — in a
 * service function (client-safe) or a `{module}.server.ts` command, call it
 * from the route, and publish it under a tool name (a same-named export in
 * `{module}.mcp.server.ts` shadows a bare primitive). The route keeps only
 * request concerns: auth, validation, company/lock gates, flash and redirect.
 *
 * Flags, in route files under `apps/erp/app/routes/x+/` (the browser half is
 * masked by the server-file source):
 * - supabase-js `.from(<table>).insert|update|upsert|delete(`
 * - Kysely `.insertInto(`, `.updateTable(`, `.deleteFrom(`
 * Comments are ignored. The existing hits are baselined as the burn-down list;
 * the baseline key has no line number, so a second identical write to the same
 * table in an already-baselined file is not caught — keep new writes out of
 * routes rather than relying on that gap.
 */
const MESSAGE =
  "Route action writes a table directly. Move the write (and anything that must run with it) into a service function or a {module}.server.ts command the route calls, and publish it for MCP (a same-named export in {module}.mcp.server.ts shadows a bare primitive).";

const SUPABASE_WRITE =
  /\.from\(\s*([^()]*?)\s*\)\s*\.(insert|update|upsert|delete)\s*\(/g;
const KYSELY_WRITE =
  /\.(insertInto|updateTable|deleteFrom)\(\s*([^()]*?)\s*\)/g;

/** Blank comments, keeping every newline so line numbers survive. */
function blankComments(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(
      /(^|[^:"'`\\])\/\/[^\n]*/g,
      (m, lead: string) => lead + " ".repeat(m.length - lead.length)
    );
}

export function isErpRouteFile(file: string): boolean {
  return /(^|\/)apps\/erp\/app\/routes\/x\+\//.test(file);
}

export const noDirectTableWriteInRoute: ConformanceCheck = {
  id: "no-direct-table-write-in-route",
  description:
    "ERP x+ route actions never write a table directly — the write lives in a service function or {module}.server.ts command the route calls, so MCP/API callers can run the same operation.",
  provenance: {
    deprecates:
      "client.from(table).insert/update/upsert/delete (or a Kysely insertInto/updateTable/deleteFrom) inside an x+ route action",
    replacedBy:
      "a service function or {module}.server.ts command called by the route and published through {module}.mcp.server.ts"
  },
  scan(file, contents) {
    if (!isErpRouteFile(file)) return [];
    const text = blankComments(contents);
    const violations: Violation[] = [];
    const lineOf = (index: number) => text.slice(0, index).split("\n").length;

    for (const m of text.matchAll(SUPABASE_WRITE)) {
      violations.push({
        file,
        line: lineOf(m.index ?? 0),
        snippet: `from(${m[1]}).${m[2]}`,
        message: MESSAGE
      });
    }
    for (const m of text.matchAll(KYSELY_WRITE)) {
      violations.push({
        file,
        line: lineOf(m.index ?? 0),
        snippet: `${m[1]}(${m[2]})`,
        message: MESSAGE
      });
    }
    return violations;
  }
};
