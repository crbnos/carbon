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
 * We flag the CONSTRUCTION primitives, not imports: `import type { Kysely,
 * KyselyDatabase }` and `import { sql } from "kysely"` are ordinary, allowed
 * service-layer imports and must never trip this. `.server.ts` files and route
 * actions (which legitimately call `getDatabaseClient()`) are out of scope —
 * only `*.service.ts` is scanned.
 */
const MESSAGE =
  "A *.service.ts must not construct a DB pool/Kysely client — take a `db: Kysely<KyselyDatabase>` argument and let the service function pass ctx.asSystem.pg (or its transaction), so the write joins the caller's transaction.";

const BANNED = [
  {
    pattern: /\b(?:getProcessPool|getPostgresConnectionPool)\s*\(/g,
    message: MESSAGE
  },
  { pattern: /getPostgresClient\s*\(/g, message: MESSAGE },
  { pattern: /new Pool\s*\(/g, message: MESSAGE },
  { pattern: /\bPostgresDriver\b/g, message: MESSAGE }
];

export const noDbClientInService: ConformanceCheck = {
  id: "no-db-client-in-service",
  description:
    "A *.service.ts never constructs a DB pool/Kysely client — the route action builds it (getDatabaseClient from ~/services/database.server) and passes it in as `db`.",
  provenance: {
    deprecates:
      "constructing a pg pool / Kysely client inside a client-reachable *.service.ts (e.g. the removed getSchedulingDb in production.service.ts)",
    replacedBy:
      "getDatabaseClient() from ~/services/database.server, passed into the service as a `db: Kysely<KyselyDatabase>` argument by the route action"
  },
  scan(file, contents) {
    // Only `*.service.ts`. A `.server.ts` is the sanctioned home for a DB
    // client, and route actions legitimately call `getDatabaseClient()`.
    if (!file.endsWith(".service.ts")) return [];
    const violations: Violation[] = [];
    contents.split("\n").forEach((text, i) => {
      for (const { pattern, message } of BANNED) {
        for (const m of text.matchAll(pattern)) {
          violations.push({ file, line: i + 1, snippet: m[0], message });
        }
      }
    });
    return violations;
  }
};
