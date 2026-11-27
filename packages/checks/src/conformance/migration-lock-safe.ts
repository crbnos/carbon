// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// The Supabase CLI runs each migration file in one transaction, so every lock
// a statement takes is held until the file commits. A CHECK or FOREIGN KEY
// added to a live table scans every row under a lock that blocks writes; added
// NOT VALID it scans nothing, and a VALIDATE CONSTRAINT in a LATER migration
// scans under SHARE UPDATE EXCLUSIVE, which lets writes continue. A VALIDATE
// in the same file inherits the ADD's lock and gains nothing (`b2e62f8c00`).
// A DROP INDEX waits for ACCESS EXCLUSIVE; with no lock_timeout it queues
// behind a long transaction and every later read and write queues behind it.

/** Migrations up to here are applied history and cannot be edited. */
const LAST_UNCHECKED = "20261124175920";

const PART = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
const NAME = String.raw`${PART}(?:\s*\.\s*${PART})?`;
const NAME_LIST = String.raw`${NAME}(?:\s*,\s*${NAME})*`;

/** `"public".x` and `x` are one object; unquoted parts fold to lower case. */
function normalizeName(raw: string): string {
  const parts = [...raw.matchAll(new RegExp(PART, "g"))].map(([p]) =>
    p.startsWith('"') ? p.slice(1, -1) : p.toLowerCase()
  );
  return parts.length === 2 && parts[0] === "public"
    ? (parts[1] ?? "")
    : parts.join(".");
}

const blank = (s: string) => s.replace(/[^\n]/g, " ");

/**
 * Comments and string contents blanked, offsets kept. A DO body runs now, so
 * it is kept and scanned; a function body runs when called, so it is blanked.
 */
function maskSql(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i] as string;
    const next = sql[i + 1];

    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out += blank(sql.slice(i, stop));
      i = stop;
      continue;
    }

    if (c === "/" && next === "*") {
      // Postgres block comments nest.
      let depth = 0;
      let j = i;
      while (j < n) {
        if (sql[j] === "/" && sql[j + 1] === "*") {
          depth++;
          j += 2;
        } else if (sql[j] === "*" && sql[j + 1] === "/") {
          depth--;
          j += 2;
          if (depth === 0) break;
        } else j++;
      }
      out += blank(sql.slice(i, j));
      i = j;
      continue;
    }

    if (c === "'") {
      // E'…' takes backslash escapes, so \' does not end it.
      const escapes = /(?:^|[^\w$])[eE]$/.test(
        sql.slice(Math.max(0, i - 2), i)
      );
      let j = i + 1;
      while (j < n) {
        if (escapes && sql[j] === "\\") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      out += `'${blank(sql.slice(i + 1, j))}'`;
      i = j + 1;
      continue;
    }

    if (c === '"') {
      const j = sql.indexOf('"', i + 1);
      const stop = j === -1 ? n : j + 1;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (c === "$" && !/[\w$]/.test(sql[i - 1] ?? "")) {
      const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i, i + 64))?.[0];
      if (tag) {
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? n : close + tag.length;
        const body = sql.slice(i + tag.length, close === -1 ? n : close);
        out += /\bDO(?:\s+LANGUAGE\s+\w+)?\s*$/i.test(out.slice(-64))
          ? blank(tag) + maskSql(body) + blank(tag)
          : blank(sql.slice(i, end));
        i = end;
        continue;
      }
    }

    out += c;
    i++;
  }
  return out;
}

/**
 * Quoted identifiers' contents replaced, so a keyword inside a name is never
 * read as SQL. Same length, so offsets carry over.
 */
const hideIdentifiers = (sql: string) =>
  sql.replace(/"[^"\n]*"/g, (m) => `"${"_".repeat(m.length - 2)}"`);

/** Statements split on `;`, with each one's start offset. */
function statements(code: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let start = 0;
  for (let i = 0; i <= code.length; i++) {
    if (i === code.length || code[i] === ";") {
      out.push({ text: code.slice(start, i), start });
      start = i + 1;
    }
  }
  return out;
}

/** An ALTER TABLE's actions, split on the commas outside parentheses. */
function actions(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (i === text.length || (c === "," && depth === 0)) {
      out.push({ text: text.slice(start, i), start });
      start = i + 1;
    }
  }
  return out;
}

const CREATE_TABLE = new RegExp(
  String.raw`\bCREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?<name>${NAME})`,
  "dgi"
);
const ALTER_TABLE = new RegExp(
  String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?<name>${NAME})`,
  "di"
);
const ADD_CONSTRAINT = new RegExp(
  String.raw`^\s*ADD\s+(?:CONSTRAINT\s+(?<name>${NAME})\s+)?(?<kind>CHECK|FOREIGN\s+KEY)\b`,
  "di"
);
const VALIDATE = new RegExp(
  String.raw`^\s*VALIDATE\s+CONSTRAINT\s+(?<name>${NAME})`,
  "di"
);
const DROP_INDEX = new RegExp(
  String.raw`\bDROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(?<names>${NAME_LIST})`,
  "di"
);
const SET_LOCK_TIMEOUT =
  /\bSET\s+(?:LOCAL\s+|SESSION\s+)?lock_timeout\s*(?:=|\bTO\b)\s*/i;
const SET_CONFIG_LOCK_TIMEOUT =
  /\bset_config\s*\(\s*'lock_timeout'\s*,\s*'(?<value>[^']*)'/i;
const RESET_LOCK_TIMEOUT = /\bRESET\s+(?:lock_timeout|ALL)\b/i;

/** `DEFAULT`, `0` and `'0'` turn the timeout off: a lock is waited for forever. */
const timeoutOn = (value: string) =>
  !/^(?:DEFAULT\b|'?0+(?:ms|s)?'?(?:\s|$))/i.test(value.trim());

function group(
  text: string,
  m: RegExpExecArray,
  name: string,
  offset: number
): string | undefined {
  const span = m.indices?.groups?.[name];
  return span ? text.slice(span[0] + offset, span[1] + offset) : undefined;
}

export function scanLockSafety(file: string, contents: string): Violation[] {
  const masked = maskSql(contents);
  const code = hideIdentifiers(masked);
  const violations: Violation[] = [];
  const lineAt = (offset: number) =>
    contents.slice(0, offset).split("\n").length;
  const report = (offset: number, length: number, message: string) =>
    violations.push({
      file,
      line: lineAt(offset),
      snippet: masked
        .slice(offset, offset + length)
        .trim()
        .replace(/\s+/g, " "),
      message
    });

  /** Tables this file creates: empty, so a scan of them costs nothing. */
  const created = new Set<string>();
  /** `table::constraint` added since the last COMMIT. */
  const added = new Set<string>();
  let lockTimeout = false;

  for (const stmt of statements(code)) {
    const { text, start } = stmt;

    for (const m of text.matchAll(CREATE_TABLE)) {
      const name = group(masked, m, "name", start);
      if (name) created.add(normalizeName(name));
    }

    if (/^\s*(?:COMMIT|END)\s*(?:WORK|TRANSACTION)?\s*$/i.test(text)) {
      added.clear();
    }

    // SET … lock_timeout and set_config read their value from the source:
    // `code` has the string contents blanked.
    const set = SET_LOCK_TIMEOUT.exec(text);
    if (set) {
      const from = start + set.index + set[0].length;
      lockTimeout = timeoutOn(contents.slice(from, start + text.length));
    }
    if (/\bset_config\s*\(/i.test(text)) {
      const raw = SET_CONFIG_LOCK_TIMEOUT.exec(
        contents.slice(start, start + text.length)
      );
      if (raw?.groups) lockTimeout = timeoutOn(raw.groups.value ?? "");
    }
    if (RESET_LOCK_TIMEOUT.test(text)) lockTimeout = false;

    const drop = DROP_INDEX.exec(text);
    if (drop && !lockTimeout) {
      const names = group(masked, drop, "names", start) ?? "";
      report(
        start + drop.index,
        drop[0].length,
        `DROP INDEX ${names.trim()} waits for an ACCESS EXCLUSIVE lock with no lock_timeout: behind one long transaction it queues every read and write of the table. Put SET lock_timeout = '5s'; before it and RESET lock_timeout; at the end of the file.`
      );
    }

    const alter = ALTER_TABLE.exec(text);
    if (!alter) continue;
    const tableRaw = group(masked, alter, "name", start) ?? "";
    const table = normalizeName(tableRaw);
    if (created.has(table)) continue;

    const listStart = alter.index + alter[0].length;
    for (const action of actions(text.slice(listStart))) {
      const at = start + listStart + action.start;
      const add = ADD_CONSTRAINT.exec(action.text);
      if (add) {
        const nameRaw = group(masked, add, "name", at);
        if (nameRaw) added.add(`${table}::${normalizeName(nameRaw)}`);
        if (/\bNOT\s+VALID\b/i.test(action.text)) continue;
        const what = nameRaw ? `ADD CONSTRAINT ${nameRaw}` : "This ADD";
        const validate = nameRaw ? nameRaw : "it";
        report(
          at,
          add[0].length,
          `${what} on ${tableRaw} checks every existing row while it holds a lock that blocks writes to the table (a foreign key locks the table it references too). Add it NOT VALID here, and VALIDATE CONSTRAINT ${validate} in a later migration: there the scan takes SHARE UPDATE EXCLUSIVE, which lets writes continue.`
        );
        continue;
      }
      const validate = VALIDATE.exec(action.text);
      if (validate) {
        const nameRaw = group(masked, validate, "name", at) ?? "";
        if (!added.has(`${table}::${normalizeName(nameRaw)}`)) continue;
        report(
          at,
          validate[0].length,
          `VALIDATE CONSTRAINT ${nameRaw} runs in the transaction that added it, so it scans ${tableRaw} under the ADD's write-blocking lock and NOT VALID gains nothing: each migration file is one transaction. Move the VALIDATE to a later migration.`
        );
      }
    }
  }
  return violations.sort((a, b) => a.line - b.line);
}

export const migrationLockSafe: ConformanceCheck = {
  id: "migration-lock-safe",
  description:
    "A migration must not scan a live table under a write-blocking lock, or wait for an ACCESS EXCLUSIVE lock with no lock_timeout.",
  provenance: {
    deprecates:
      'ALTER TABLE "t" ADD CONSTRAINT "c" CHECK (…) / FOREIGN KEY (…); VALIDATE CONSTRAINT "c" in the same file; DROP INDEX with no lock_timeout',
    replacedBy:
      'ADD CONSTRAINT "c" … NOT VALID, then VALIDATE CONSTRAINT "c" in a later migration; SET lock_timeout = \'5s\' before DROP INDEX',
    since: `after ${LAST_UNCHECKED}_mixed-completion-handler.sql`,
    incidents: [
      "efde0fe4ea",
      "ddeaab8da5",
      "7a2220cf4d",
      "b52644969b",
      "dab1966019",
      "b2e62f8c00",
      "86bd0af78d",
      "90634155b3"
    ]
  },
  // The text every file this check flags contains.
  triggers: [
    "ADD CONSTRAINT",
    "ADD CHECK",
    "ADD FOREIGN KEY",
    "VALIDATE CONSTRAINT",
    "DROP INDEX"
  ],
  scan(file, contents) {
    const base = file.split("/").pop() ?? file;
    const timestamp = /^(\d{14})_/.exec(base)?.[1];
    if (!timestamp || timestamp <= LAST_UNCHECKED) return [];
    return scanLockSafety(file, contents);
  }
};
