// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

/**
 * A `*.service.ts` file must never CONSTRUCT a database connection, pool, or
 * Kysely client. Its functions are building blocks that a service function
 * calls, and they take the handle they run on as a
 * `db: Kysely<KyselyDatabase>` argument: `ctx.asSystem.pg`, or the `tx` of an
 * open `ctx.transaction`. A client built inside the service writes outside the
 * caller's transaction, so a refusal that should roll the write back cannot.
 *
 * We flag the CONSTRUCTION primitives and the app's client getters
 * (`getDatabaseClient()`, `getJobDatabaseClient()`), not imports:
 * `import type { Kysely, KyselyDatabase }` and `import { sql } from "kysely"`
 * are ordinary, allowed service-layer imports and must never trip this.
 * `.server.ts` files and route actions (which legitimately call
 * `getDatabaseClient()`) are out of scope — only `*.service.ts` is scanned.
 * Comment lines are skipped: a building block's doc may name the getter its
 * caller uses.
 */
const MESSAGE =
  "A *.service.ts must not construct or fetch a DB pool/Kysely client (getDatabaseClient() included) — take a `db: Kysely<KyselyDatabase>` argument and let the service function pass ctx.asSystem.pg (or its transaction), so the write joins the caller's transaction.";

const BANNED = [
  {
    pattern: /\b(?:getProcessPool|getPostgresConnectionPool)\s*\(/g,
    message: MESSAGE
  },
  { pattern: /getPostgresClient\s*\(/g, message: MESSAGE },
  { pattern: /new Pool\s*\(/g, message: MESSAGE },
  { pattern: /\bPostgresDriver\b/g, message: MESSAGE },
  {
    pattern: /\b(?:getDatabaseClient|getJobDatabaseClient)\s*\(/g,
    message: MESSAGE
  }
];

const COMMENT_LINE = /^\s*(?:\/\/|\/?\*)/;

export const noDbClientInService: ConformanceCheck = {
  id: "no-db-client-in-service",
  description:
    "A *.service.ts never constructs or fetches a DB pool/Kysely client — its caller passes one in as `db` (ctx.asSystem.pg in a service function, getDatabaseClient() in a route).",
  provenance: {
    deprecates:
      "constructing a pg pool / Kysely client, or calling getDatabaseClient() / getJobDatabaseClient(), inside a *.service.ts (e.g. the removed getSchedulingDb in production.service.ts)",
    replacedBy:
      "a `db: Kysely<KyselyDatabase>` argument: ctx.asSystem.pg (or its transaction) from the service function, getDatabaseClient() from a route"
  },
  scan(file, contents) {
    // Only `*.service.ts`. A `.server.ts` is the sanctioned home for a DB
    // client, and route actions legitimately call `getDatabaseClient()`.
    if (!file.endsWith(".service.ts")) return [];
    const violations: Violation[] = [];
    contents.split("\n").forEach((text, i) => {
      if (COMMENT_LINE.test(text)) return;
      for (const { pattern, message } of BANNED) {
        for (const m of text.matchAll(pattern)) {
          violations.push({ file, line: i + 1, snippet: m[0], message });
        }
      }
    });
    return violations;
  }
};
