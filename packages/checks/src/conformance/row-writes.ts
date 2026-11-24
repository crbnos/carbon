// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The row writes and row locks a TypeScript file makes, read from its text,
 * for the concurrency checks (`status-write-guarded`, `counter-write-relative`).
 *
 * A write is one of:
 *  - Kysely `.updateTable("t").set({ … })…` (the predicates are its `.where*`)
 *  - supabase-js `.from("t").update({ … })…` (the predicates are the filters
 *    chained after `.update`)
 *  - `updateRows(db, "t", { … }, { … })` / `updateRowsById(db, "t", companyId,
 *    rows)` from `@carbon/database/rows`
 *
 * The row is read from the object literal in the call, or, when the call is
 * handed a local of the same function, from the object literals that build
 * that local (its initializer, `local[k] = …`, `local.push(…)`, and
 * `local.column = …`). The postings build their `updateRowsById` rows that way:
 * `materialIssuedUpdates.push({ id, data: { quantityIssued } })`, or a
 * `reduce` into a map passed as `Object.entries(map)`. A row that arrives as a
 * parameter, or is built in another function, is invisible.
 *
 * A function is a top-level statement: Biome puts each at column 0 and indents
 * everything inside it, so a line that starts with an identifier character
 * opens the next one (as `mes-unit-write-resolves-unit` reads it). A class is
 * split into its methods.
 */

export type Field = { name: string; value: string; index: number };

export type RowWrite = {
  /** Offset of the call that names the table. */
  index: number;
  table: string;
  /** The alias in `updateTable("t as a")`, so `a.status` is the same column. */
  alias: string | null;
  fields: Field[];
  /** Text of the statement's predicates (Kysely `.where*`, supabase filters, the `updateRows` filter). */
  guards: string;
};

export type Region = { start: number; end: number; name: string };

export type RowLock = { index: number; table: string };

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;

/** Index just past the string literal that opens at `i`. */
function skipString(text: string, i: number): number {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === "\\") {
      j++;
      continue;
    }
    if (text[j] === quote) return j + 1;
  }
  return text.length;
}

/** Index of the bracket matching the one at `open`, skipping strings. */
export function matchBracket(text: string, open: number): number {
  const opener = text[open] as string;
  const close = { "(": ")", "[": "]", "{": "}" }[opener];
  if (!close) return open;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i) - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

function skipSpace(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i] as string)) i++;
  return i;
}

export type Call = { name: string; open: number; close: number };

/**
 * The `.member(…)` calls chained after `from` (an index just past a call's
 * `)`), in order. A property access, `?.` and `!` continue the chain, and so
 * does the cast that wraps a builder: `(client.from("t") as any).update(…)`.
 */
export function chainCalls(text: string, from: number): Call[] {
  const calls: Call[] = [];
  let i = from;
  for (;;) {
    i = skipSpace(text, i);
    const cast = /^as\s+[\w$.]+\s*\)/.exec(text.slice(i, i + 60));
    if (cast) {
      i += cast[0].length;
      continue;
    }
    if (text[i] === "!") {
      i++;
      continue;
    }
    if (text[i] === "?" && text[i + 1] === ".") i++;
    if (text[i] !== ".") return calls;
    i = skipSpace(text, i + 1);
    if (!IDENT_START.test(text[i] ?? "")) return calls;
    let end = i;
    while (end < text.length && IDENT_PART.test(text[end] as string)) end++;
    const name = text.slice(i, end);
    let after = skipSpace(text, end);
    if (text[after] === "<") {
      // A type argument: `.select<…>(`, `.returns<Row[]>()`.
      const typeEnd = text.indexOf(">(", after);
      if (typeEnd !== -1 && typeEnd - after < 200) after = typeEnd + 1;
    }
    if (text[after] !== "(") {
      i = after;
      continue;
    }
    const close = matchBracket(text, after);
    calls.push({ name, open: after, close });
    i = close + 1;
  }
}

/** The arguments of the call whose `(` is at `open`, each with its offset. */
export function callArguments(
  text: string,
  open: number
): { text: string; start: number }[] {
  const close = matchBracket(text, open);
  const args: { text: string; start: number }[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const c = text[i] as string;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i) - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      args.push({ text: text.slice(start, i), start });
      start = i + 1;
    }
  }
  if (text.slice(start, close).trim() !== "") {
    args.push({ text: text.slice(start, close), start });
  }
  return args;
}

/**
 * The top-level entries of the object literal whose `{` is at `open`: `key:
 * value`, `"key": value` and shorthand `key`. Spreads and methods are skipped.
 */
export function objectEntries(text: string, open: number): Field[] {
  const close = matchBracket(text, open);
  const fields: Field[] = [];
  let i = open + 1;
  while (i < close) {
    i = skipSpace(text, i);
    if (i >= close) break;
    // The entry runs to the next comma at depth 0.
    let end = i;
    let depth = 0;
    for (; end < close; end++) {
      const c = text[end] as string;
      if (c === '"' || c === "'" || c === "`") {
        end = skipString(text, end) - 1;
        continue;
      }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (c === "," && depth === 0) break;
    }
    const entry = text.slice(i, end);
    const m = /^(?:["'`](\w+)["'`]|([A-Za-z_$][\w$]*))\s*(:)?/.exec(entry);
    if (m && !entry.startsWith("...")) {
      const name = (m[1] ?? m[2]) as string;
      if (m[3]) {
        fields.push({
          name,
          value: entry.slice(m[0].length).trim(),
          index: i
        });
      } else if (entry.trim() === name) {
        fields.push({ name, value: name, index: i });
      }
    }
    i = end + 1;
  }
  return fields;
}

/** The `{` of the row object an argument holds: `{…}` or `(eb) => ({…})`. */
function rowObjectStart(text: string, arg: { text: string; start: number }) {
  const lead = /^\s*(?:\(?\s*[\w$]*\s*\)?\s*=>\s*\(?\s*)?\{/.exec(arg.text);
  return lead ? arg.start + lead[0].length - 1 : null;
}

const literalTableAt = (text: string, open: number) =>
  /^\(\s*["'`](\w+)(?:\s+as\s+(\w+))?["'`]/.exec(text.slice(open, open + 200));

/** Supabase filters that name the column they test; the rest shape the reply. */
const SUPABASE_NON_FILTERS = new Set([
  "select",
  "single",
  "maybeSingle",
  "throwOnError",
  "returns",
  "abortSignal",
  "csv",
  "explain",
  "limit",
  "order",
  "then"
]);

function regionFor(regions: Region[], index: number): Region | undefined {
  return regions.find((r) => r.start <= index && index < r.end);
}

/**
 * The calls chained onto a builder held in a variable after the write:
 * `let q = client.from("t").update({ status })…; if (from) q = q.eq("status",
 * from);`. Only the variable the write's own statement assigns is followed.
 */
function laterCalls(text: string, regions: Region[], index: number): Call[] {
  const region = regionFor(regions, index);
  if (!region) return [];
  const head = text.slice(region.start, index);
  const start = Math.max(
    head.lastIndexOf(";"),
    head.lastIndexOf("{"),
    head.lastIndexOf("}")
  );
  const name = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(
    head.slice(start + 1)
  )?.[1];
  if (!name) return [];
  const calls: Call[] = [];
  const body = text.slice(index, region.end);
  for (const m of body.matchAll(new RegExp(`\\b${name}\\b`, "g"))) {
    calls.push(...chainCalls(text, index + (m.index ?? 0) + name.length));
  }
  return calls;
}

type Span = { text: string; start: number };

/**
 * Index just past the `=` of a declaration whose name ends at `from`, after
 * an optional type annotation (which may hold `{ a: T; }`, `<…>` and `=>`), or
 * null when the name has no initializer: `for (const x of …)`, `let x;`.
 */
export function initializerStart(text: string, from: number): number | null {
  let i = skipSpace(text, from);
  if (text[i] === "=" && text[i + 1] !== "=" && text[i + 1] !== ">") {
    return i + 1;
  }
  if (text[i] !== ":") return null;
  let depth = 0;
  for (i++; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i) - 1;
      continue;
    }
    if (c === "=" && text[i + 1] === ">") {
      i++;
      continue;
    }
    if (c === "(" || c === "[" || c === "{" || c === "<") depth++;
    else if (c === ")" || c === "]" || c === "}" || c === ">") {
      if (depth === 0) return null;
      depth--;
    } else if (depth === 0) {
      if (c === "=" && text[i + 1] !== "=") return i + 1;
      if (c === ";" || c === ",") return null;
    }
  }
  return null;
}

/**
 * The value a local was given at its nearest declaration before `before`
 * (from `regionStart`): `{ start, end }` of the initializer, or null.
 */
export function nearestInitializer(
  text: string,
  regionStart: number,
  before: number,
  name: string
): Span | null {
  const escaped = name.replace(/\$/g, "\\$");
  const declarations = [
    ...text
      .slice(regionStart, before)
      .matchAll(new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\b`, "g"))
  ];
  const nearest = declarations.pop();
  if (!nearest) return null;
  const afterName = regionStart + (nearest.index ?? 0) + nearest[0].length;
  const start = initializerStart(text, afterName);
  if (start === null) return null;
  const end = statementEnd(text, start, text.length);
  return { text: text.slice(start, end), start };
}

/** Index of the `;` that ends the statement running from `from` (depth 0). */
function statementEnd(text: string, from: number, limit: number): number {
  let depth = 0;
  for (let i = from; i < limit; i++) {
    const c = text[i] as string;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i) - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return i;
      depth--;
    } else if (c === ";" && depth === 0) return i;
  }
  return limit;
}

/** Every object literal in a span (a `{` in value position, not a block). */
function objectLiterals(text: string, span: Span): Field[] {
  const fields: Field[] = [];
  for (let i = span.start; i < span.start + span.text.length; i++) {
    const c = text[i] as string;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i) - 1;
      continue;
    }
    if (c !== "{") continue;
    let j = i - 1;
    while (j > 0 && /\s/.test(text[j] as string)) j--;
    const before = text.slice(Math.max(0, j - 5), j + 1);
    if (/[([,:=?|&]$/.test(before) || /\breturn$/.test(before)) {
      fields.push(...objectEntries(text, i));
    }
  }
  return fields;
}

/**
 * The rows a write receives through a local of its function: the local's
 * initializer, `local[k] = …`, `local.push(…)` / `.set(…)` and, for a row
 * object, `local.column = …`. One level only; a parameter is invisible.
 */
function tracedRows(
  text: string,
  region: Region | undefined,
  argument: Span
): Field[] {
  if (!region) return [];
  const fields: Field[] = [];
  const names = new Set(
    [...argument.text.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\b/g)].map(
      (m) => m[1] as string
    )
  );
  for (const name of names) {
    const escaped = name.replace(/\$/g, "\\$");
    // The nearest declaration before the write: a long posting function
    // reuses one local name in several branches.
    const initializer = nearestInitializer(
      text,
      region.start,
      argument.start,
      name
    );
    if (!initializer) continue;
    const from = initializer.start;
    const body = text.slice(from, argument.start);
    const sources: Span[] = [initializer];
    const starts = new RegExp(
      `\\b(?:${escaped}\\s*\\[[^\\]]*\\]\\s*=(?![=>])|${escaped}\\.(?:push|set|unshift)\\s*\\()`,
      "g"
    );
    for (const m of body.matchAll(starts)) {
      const at = from + (m.index ?? 0) + m[0].length;
      const end = statementEnd(text, at, region.end);
      sources.push({ text: text.slice(at, end), start: at });
    }
    for (const source of sources) fields.push(...objectLiterals(text, source));
    const member = new RegExp(`\\b${escaped}\\.(\\w+)\\s*=(?![=>])`, "g");
    for (const m of body.matchAll(member)) {
      const at = from + (m.index ?? 0) + m[0].length;
      fields.push({
        name: m[1] as string,
        value: text.slice(at, statementEnd(text, at, region.end)).trim(),
        index: from + (m.index ?? 0)
      });
    }
  }
  return fields;
}

/**
 * The fields a write's row argument sets: a literal row object's own keys, or
 * the object literals that reach it through a local (`tracedRows`). For
 * `updateRowsById` the argument is the rows array, whose literals are read
 * whole (`{ id, data: { … } }`).
 */
function rowFields(
  text: string,
  region: Region | undefined,
  argument: Span | undefined,
  array: boolean
): Field[] {
  if (!argument) return [];
  const open = array ? null : rowObjectStart(text, argument);
  if (open !== null) return objectEntries(text, open);
  return [
    ...(array ? objectLiterals(text, argument) : []),
    ...tracedRows(text, region, argument)
  ];
}

/** Every row write in the (comment-blanked) text; see the file header. */
export function rowWrites(text: string, regions: Region[]): RowWrite[] {
  const writes: RowWrite[] = [];

  for (const m of text.matchAll(/\.updateTable\s*\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const table = literalTableAt(text, open);
    if (!table) continue;
    const calls = chainCalls(text, matchBracket(text, open) + 1);
    const set = calls.find((c) => c.name === "set");
    const setArg = set ? callArguments(text, set.open)[0] : undefined;
    writes.push({
      index: m.index ?? 0,
      table: table[1] as string,
      alias: table[2] ?? null,
      fields: rowFields(text, regionFor(regions, m.index ?? 0), setArg, false),
      guards: [...calls, ...laterCalls(text, regions, m.index ?? 0)]
        .filter((c) => c.name.startsWith("where"))
        .map((c) => text.slice(c.open, c.close + 1))
        .join(" ")
    });
  }

  for (const m of text.matchAll(/\.from\s*\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const table = literalTableAt(text, open);
    if (!table) continue;
    const calls = chainCalls(text, matchBracket(text, open) + 1);
    const at = calls.findIndex((c) => c.name === "update");
    const update = calls[at];
    if (!update) continue;
    const arg = callArguments(text, update.open)[0];
    writes.push({
      index: m.index ?? 0,
      table: table[1] as string,
      alias: null,
      fields: rowFields(text, regionFor(regions, m.index ?? 0), arg, false),
      guards: [
        ...calls.slice(at + 1),
        ...laterCalls(text, regions, m.index ?? 0)
      ]
        .filter((c) => !SUPABASE_NON_FILTERS.has(c.name))
        .map((c) => text.slice(c.open, c.close + 1))
        .join(" ")
    });
  }

  for (const m of text.matchAll(/\b(updateRows|updateRowsById)\s*\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const args = callArguments(text, open);
    const table = /^\s*["'`](\w+)["'`]\s*$/.exec(args[1]?.text ?? "")?.[1];
    if (!table) continue;
    const byId = m[1] === "updateRowsById";
    writes.push({
      index: m.index ?? 0,
      table,
      alias: null,
      fields: rowFields(
        text,
        regionFor(regions, m.index ?? 0),
        args[byId ? 3 : 2],
        byId
      ),
      guards: byId ? "" : (args[3]?.text ?? "")
    });
  }

  return writes.sort((a, b) => a.index - b.index);
}

const DECLARATION =
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?\s+([\w$]+)|(?:const|let|var)\s+([\w$]+)|class\s+([\w$]+)|([\w$]+))/;

/** A class member at Biome's two-space indent: `  async name(`, `  name = (`. */
const METHOD =
  /^ {2}(?:(?:public|private|protected|static|async|override|readonly|get|set)\s+)*([\w$]+)\s*(?:<[^>]*>)?\s*(?:\(|=\s*(?:async\s*)?\()/;

/**
 * The file's top-level statements, each named by what it declares or calls.
 * A class is split into its methods (`Class.method`), so a lock in one method
 * never stands for a write in another.
 */
export function topLevelRegions(text: string): Region[] {
  const regions: Region[] = [];
  let offset = 0;
  let className: string | null = null;
  const open = (start: number, name: string) => {
    const previous = regions[regions.length - 1];
    if (previous) previous.end = start;
    regions.push({ start, end: text.length, name });
  };
  for (const line of text.split("\n")) {
    if (/^[A-Za-z_$@]/.test(line)) {
      const m = DECLARATION.exec(line);
      className = m?.[3] ?? null;
      open(offset, m?.[1] ?? m?.[2] ?? m?.[3] ?? m?.[4] ?? "<top level>");
    } else if (className) {
      const method = METHOD.exec(line)?.[1];
      if (method) open(offset, `${className}.${method}`);
    }
    offset += line.length + 1;
  }
  return regions;
}

export function regionOf(regions: Region[], index: number): Region | undefined {
  return regionFor(regions, index);
}

/**
 * Row locks taken in the text: a Kysely `.selectFrom("t")…forUpdate()` /
 * `.forNoKeyUpdate()` (also when the query is held in a variable and locked on
 * a later line: the lock goes to the nearest `selectFrom` before it), and raw
 * SQL `… FROM t … FOR [NO KEY] UPDATE`.
 */
export function rowLocks(text: string): RowLock[] {
  const locks: RowLock[] = [];
  const covered = new Set<number>();
  const selects = [...text.matchAll(/\.selectFrom\s*\(/g)].map((m) => {
    const open = (m.index ?? 0) + m[0].length - 1;
    return { index: m.index ?? 0, open, table: literalTableAt(text, open) };
  });
  for (const select of selects) {
    if (!select.table) continue;
    const calls = chainCalls(text, matchBracket(text, select.open) + 1);
    const lock = calls.find(
      (c) => c.name === "forUpdate" || c.name === "forNoKeyUpdate"
    );
    if (!lock) continue;
    covered.add(lock.open);
    locks.push({ index: select.index, table: select.table[1] as string });
  }
  for (const m of text.matchAll(/\.(?:forUpdate|forNoKeyUpdate)\s*\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    if (covered.has(open)) continue;
    const before = selects.filter((s) => s.index < (m.index ?? 0)).pop();
    if (before?.table) {
      locks.push({ index: m.index ?? 0, table: before.table[1] as string });
    }
  }
  for (const m of text.matchAll(/\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b/g)) {
    const head = text.slice(Math.max(0, (m.index ?? 0) - 2000), m.index);
    const from = [
      ...head.matchAll(/\bFROM\s+(?:"?public"?\.)?"?([A-Za-z_]\w*)"?/gi)
    ].pop();
    if (from?.[1]) locks.push({ index: m.index ?? 0, table: from[1] });
  }
  return locks.sort((a, b) => a.index - b.index);
}

/**
 * The row locks a function holds once it has reached `index`: its own, and
 * those of any function in the same file it called before that point (a
 * helper such as `lockPostedReceipt` that locks the row for its callers).
 */
export function locksBefore(
  text: string,
  regions: Region[],
  locks: RowLock[],
  index: number
): Set<string> {
  const region = regionFor(regions, index);
  const tables = new Set<string>();
  if (!region) return tables;
  for (const lock of locks) {
    if (lock.index >= region.start && lock.index < index)
      tables.add(lock.table);
  }
  const body = text.slice(region.start, index);
  for (const helper of regions) {
    if (helper === region || !/^[A-Za-z_$][\w$]*$/.test(helper.name)) continue;
    const own = locks.filter(
      (l) => l.index >= helper.start && l.index < helper.end
    );
    if (own.length === 0) continue;
    if (!new RegExp(`\\b${helper.name}\\s*\\(`).test(body)) continue;
    for (const lock of own) tables.add(lock.table);
  }
  return tables;
}

/** Whether `name` (or `alias.name`) appears as a quoted column in `text`. */
export function namesColumn(
  text: string,
  name: string,
  alias: string | null,
  table: string
): boolean {
  const qualifiers = [table, alias].filter(Boolean).join("|");
  return new RegExp(
    `["'\`](?:(?:${qualifiers})\\.)?${name}["'\`]|\\b${name}\\.(?:eq|neq|in|is|not)\\.|[{,]\\s*${name}\\s*[:,}]`
  ).test(text);
}
