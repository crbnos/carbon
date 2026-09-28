import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import baseline from "./mcp-status-transitions.baseline.json";

// A status change in the UI is a route action that runs side effects around
// the write: cascades (a cancelled job's picking lists), inventory (an NCR
// close posting its dispositions), approvals (a PO finalize), notifications.
// Every exported service function is published as a tool, so a service
// function that writes a `status` column is a tool that flips the column and
// skips all of that — the class of bug where `production_updateJobStatus`
// "cancelled" a job while its picked material stayed at the line.
//
// The rule: a service function that writes `status` must be shadowed by a
// same-named export in its module's `{module}.mcp.server.ts` companion, which
// publishes the route's transition command under the tool name instead. The
// existing exceptions are baselined in `mcp-status-transitions.baseline.json`,
// each with the reason it is allowed or the follow-up it waits on. A new
// status writer fails here until it is shadowed or baselined with a reason; a
// baseline entry that no longer matches fails too, so the list only shrinks.
//
// What counts as a status write (textual, per exported function):
// - supabase-js `.update(` / `.upsert(` or Kysely `.set(` whose argument
//   mentions a `status` key (`status:`, `status,`, `{ status }`), or
// - such a write whose argument is a variable or spread, when the function's
//   parameters declare a `status` field or its body builds one (`status:`).

const MODULES_DIR = join(__dirname, "../app/modules");

type Baseline = Record<string, string>;

function exportedFunctions(
  source: string
): { name: string; params: string; body: string }[] {
  const out: { name: string; params: string; body: string }[] = [];
  const re = /^export (?:async )?function (\w+)\s*(?:<[^>]*>)?\s*\(/gm;
  const starts = [...source.matchAll(re)];
  for (let i = 0; i < starts.length; i++) {
    const match = starts[i]!;
    const start = match.index!;
    const end =
      i + 1 < starts.length ? starts[i + 1]!.index! : source.length;
    const text = source.slice(start, end);
    const open = match[0].length - 1;
    const close = matchingParen(text, open);
    out.push({
      name: match[1]!,
      params: text.slice(open + 1, close),
      body: text.slice(close + 1)
    });
  }
  return out;
}

function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const STATUS_KEY = /(^|[\s{,])status\s*(?:[:,}]|$)/m;
const PARAM_STATUS = /(^|[\s{,(;])status\??\s*:/m;

function writesStatus(fn: { params: string; body: string }): boolean {
  const writeCall = /\.(update|upsert|set)\(/g;
  for (const m of fn.body.matchAll(writeCall)) {
    // `.set(` is a Kysely write only inside an updateTable chain (not Map.set).
    if (
      m[1] === "set" &&
      !/\.updateTable\([^;]*$/.test(fn.body.slice(0, m.index!))
    ) {
      continue;
    }
    const open = m.index! + m[0].length - 1;
    const arg = fn.body.slice(open + 1, matchingParen(fn.body, open));
    if (STATUS_KEY.test(arg)) return true;
    // A variable/spread payload: its shape comes from the parameters or
    // from an object literal built earlier in the body.
    if (!arg.trim().startsWith("{") || /\.\.\.\w/.test(arg)) {
      if (PARAM_STATUS.test(fn.params) || STATUS_KEY.test(fn.body)) {
        return true;
      }
    }
  }
  return false;
}

function companionExports(module: string): Set<string> {
  try {
    const source = readFileSync(
      join(MODULES_DIR, module, `${module}.mcp.server.ts`),
      "utf8"
    );
    return new Set(exportedFunctions(source).map((f) => f.name));
  } catch {
    return new Set();
  }
}

function statusWriters(): string[] {
  const found: string[] = [];
  for (const module of readdirSync(MODULES_DIR)) {
    for (const file of [`${module}.service.ts`, `${module}.ee.service.ts`]) {
      let source: string;
      try {
        source = readFileSync(join(MODULES_DIR, module, file), "utf8");
      } catch {
        continue;
      }
      for (const fn of exportedFunctions(stripComments(source))) {
        if (writesStatus(fn)) found.push(`${module}_${fn.name}`);
      }
    }
  }
  return found.sort();
}


describe("status writes go through transition commands", () => {
  const writers = statusWriters();
  const known = baseline as Baseline;

  it("finds the status writers it is meant to find", () => {
    // Self-test: these write status and are shadowed by a transition command.
    for (const tool of [
      "production_updateJobStatus",
      "inventory_updatePickingListStatus",
      "quality_updateIssueStatus",
      "items_updateChangeNoticeStatus",
      "purchasing_finalizePurchaseOrder"
    ]) {
      expect(writers, tool).toContain(tool);
    }
  });

  it("every status writer is shadowed by a companion command or baselined with a reason", () => {
    const unguarded = writers.filter((tool) => {
      const [module, ...rest] = tool.split("_");
      const name = rest.join("_");
      return !companionExports(module!).has(name) && !(tool in known);
    });
    expect(
      unguarded,
      "New status writer: publish the route's transition command under this tool name in {module}.mcp.server.ts, or add it to mcp-status-transitions.baseline.json with the reason it needs no orchestration."
    ).toEqual([]);
  });

  it("every baseline entry is still a status writer, unshadowed, with a reason", () => {
    for (const [tool, reason] of Object.entries(known)) {
      const [module, ...rest] = tool.split("_");
      expect(writers, `${tool} no longer writes status; remove it`).toContain(
        tool
      );
      expect(
        companionExports(module!).has(rest.join("_")),
        `${tool} is shadowed now; remove it from the baseline`
      ).toBe(false);
      expect(reason.trim().length, `${tool} needs a reason`).toBeGreaterThan(
        10
      );
    }
  });
});
