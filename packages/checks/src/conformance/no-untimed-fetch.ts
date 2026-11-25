// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";
import { blankComments } from "../sources/comments";
import { maskClientCode } from "../sources/server-files";
import { REQUEST_HANDLING_ROOTS } from "../sources/typescript";
import { callArguments, matchBracket } from "./row-writes";

/**
 * Server code that calls another service over HTTP sets a timeout. Node's
 * `fetch` and axios wait for ever by default, so a third party that accepts
 * the connection and never answers holds the request, the Inngest step, a
 * refresh lease or a promise other callers share until the platform kills it.
 * Fixed one at a time: the sign-up settings read (1098851cee), the GTM forward
 * that kept a serverless instance up (1f5183a1f2) and the Onshape token
 * exchange that held the refresh lease (7138724800).
 *
 * Flags, in server code only:
 *  - `fetch(url)` with no options, or with an options object literal that has
 *    no `signal`;
 *  - `axios.create({ … })` with no `timeout` (or `signal`);
 *  - `axios.get/post/…(…)` whose config is missing or has neither.
 *
 * Not flagged, because the timeout may be there and the text cannot show it:
 *  - a URL that is a path on this origin (`"/api/…"`, `` `/…` ``, `path.to.…`);
 *  - an options/config argument that is not an object literal (`fetch(input,
 *    init)` in a wrapper passes its caller's signal through);
 *  - an object literal that spreads a name (`{ ...init, headers }`,
 *    `...transport`); a spread of an inline literal counts only if it names
 *    `signal` / `timeout`;
 *  - `fetch(...params)`, a wrapper forwarding its caller's arguments.
 *
 * A browser `.ts` file inside these roots that no path rule identifies is
 * read as server code; the ones that existed are baselined.
 */

// The roots the check reads: every app and package that serves a request or
// runs a job, plus the shared packages whose server files call third parties.
// Browser files inside them are skipped by `isServerFile`.
export const UNTIMED_FETCH_ROOTS = [
  ...REQUEST_HANDLING_ROOTS,
  "packages/documents/src",
  "packages/env/src",
  "packages/printing/src",
  "packages/stripe/src"
];

const ROUTE_DIR = /^apps\/[^/]+\/app\/routes\//;
// Browser code: components, hooks, stores, a module's ui/, and the
// browser-safe module files (see module-files.md).
const BROWSER_DIR = /(?:^|\/)(?:components|hooks|stores|ui)\//;
const BROWSER_FILE = /(?:\.client\.tsx?|\.models\.ts|\.utils\.ts|\/types\.ts)$/;

/** Whether a file runs on the server: the check reads only those. */
export function isServerFile(file: string): boolean {
  if (ROUTE_DIR.test(file)) return true;
  if (file.endsWith(".tsx")) return false;
  return !BROWSER_DIR.test(file) && !BROWSER_FILE.test(file);
}

// `fetch(` / `globalThis.fetch(`, not `.fetch(` on another object, `refetch(`
// or a `fetch` method declaration.
const FETCH_CALL = /(?<![\w$.])(?:globalThis\.)?fetch\s*\(/g;
const AXIOS_CALL =
  /(?<![\w$.])axios\.(create|request|get|delete|head|options|post|put|patch)\s*\(/g;

/** Which argument holds the config, by axios method. */
const AXIOS_CONFIG_INDEX: Record<string, number> = {
  create: 0,
  request: 0,
  get: 1,
  delete: 1,
  head: 1,
  options: 1,
  post: 2,
  put: 2,
  patch: 2
};

/** A URL that is a path on this origin: no third party to stall. */
function isSameOrigin(url: string): boolean {
  return /^(?:["'`]\/(?!\/)|path\.to\.|new URL\(\s*["'`]\/(?!\/))/.test(url);
}

/**
 * Whether an argument might carry one of `keys`: true unless it is an object
 * literal that names none of them. A spread of a name (`...init`,
 * `...transport`) may carry one, so it counts; a spread of an inline literal
 * (`...(hasBody && { duplex: "half" })`) counts only when it names one.
 */
function mayCarry(
  text: string,
  arg: { text: string; start: number } | undefined,
  keys: string[]
): boolean {
  if (!arg) return false;
  const lead = arg.text.length - arg.text.trimStart().length;
  const open = arg.start + lead;
  if (text[open] !== "{") return true;
  const named = new RegExp(`\\b(?:${keys.join("|")})\\b`);
  for (const entry of callArguments(text, open)) {
    const body = entry.text.trim();
    if (body.startsWith("...")) {
      const spread = body.slice(3);
      if (!spread.includes("{") || named.test(spread)) return true;
      continue;
    }
    const key = /^(?:["'`](\w+)["'`]|([A-Za-z_$][\w$]*))/.exec(body);
    if (key && keys.includes((key[1] ?? key[2]) as string)) return true;
  }
  return false;
}

const lineOf = (text: string, index: number) =>
  text.slice(0, index).split("\n").length;

const FETCH_MESSAGE =
  "A fetch to another service needs a timeout: pass `signal: AbortSignal.timeout(<ms>)` " +
  "(`AbortSignal.any([signal, AbortSignal.timeout(<ms>)])` to keep a caller's signal). " +
  "Without one a stalled endpoint holds the request, the Inngest step or a shared promise " +
  "until the platform kills it.";

const AXIOS_MESSAGE =
  "An axios call to another service needs a timeout: set `timeout: <ms>` in `axios.create({ … })` " +
  "or the request config. Without one a stalled endpoint holds the request, the Inngest step or " +
  "a shared promise until the platform kills it.";

export const noUntimedFetch: ConformanceCheck = {
  id: "no-untimed-fetch",
  description:
    "Server code calling another service over HTTP sets a timeout (fetch signal, axios timeout)",
  provenance: {
    deprecates: "fetch(url, { … }) / axios.create({ … }) with no timeout",
    replacedBy:
      "fetch(url, { …, signal: AbortSignal.timeout(ms) }); axios.create({ …, timeout: ms })",
    since: "2026-11-25",
    incidents: ["1098851cee", "1f5183a1f2", "7138724800"]
  },
  triggers: ["fetch(", "axios."],
  scan(file: string, contents: string): Violation[] {
    if (!isServerFile(file)) return [];
    const text = blankComments(
      ROUTE_DIR.test(file) ? maskClientCode(contents) : contents
    );
    const lines = contents.split("\n");
    const violations: Violation[] = [];
    const report = (index: number, message: string) => {
      const line = lineOf(text, index);
      violations.push({
        file,
        line,
        snippet: (lines[line - 1] ?? "").trim(),
        message
      });
    };

    for (const m of text.matchAll(FETCH_CALL)) {
      const index = m.index ?? 0;
      const open = index + m[0].length - 1;
      const close = matchBracket(text, open);
      // `fetch(url) {` / `fetch(url): T {` declares a method, it calls nothing.
      if (/^\s*(?::[^;{]*)?\{/.test(text.slice(close + 1, close + 200)))
        continue;
      const args = callArguments(text, open);
      const url = args[0]?.text.trim() ?? "";
      // `fetch(...params)` forwards its caller's arguments, signal included.
      if (url === "" || url.startsWith("...") || isSameOrigin(url)) continue;
      if (mayCarry(text, args[1], ["signal"])) continue;
      report(index, FETCH_MESSAGE);
    }

    for (const m of text.matchAll(AXIOS_CALL)) {
      const index = m.index ?? 0;
      const method = m[1] as string;
      const open = index + m[0].length - 1;
      const args = callArguments(text, open);
      if (method !== "create" && method !== "request") {
        const url = args[0]?.text.trim() ?? "";
        if (isSameOrigin(url)) continue;
      }
      const config = args[AXIOS_CONFIG_INDEX[method] as number];
      if (mayCarry(text, config, ["timeout", "signal"])) continue;
      report(index, AXIOS_MESSAGE);
    }

    return violations;
  }
};
