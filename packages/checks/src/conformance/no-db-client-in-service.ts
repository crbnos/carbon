import type { ConformanceCheck, Violation } from "../check";

/**
 * A `*.service.ts` file must never CONSTRUCT a database connection, pool, or
 * Kysely client. Service files are re-exported through the module barrel that
 * client components value-import (see each module's `index.ts` barrel), so
 * anything a service statically pulls in is bundled for the BROWSER. A `pg`
 * pool / Kysely driver constructed there either leaks server-only code into the
 * client bundle or forces a dynamic-`import()` workaround to hide it — both are
 * a smell for the same missing seam.
 *
 * The seam: the Kysely handle is built ONCE in a `.server` file
 * (`getDatabaseClient()` in `~/services/database.server`), the route action
 * imports it, and it is PASSED INTO the service as a
 * `db: Kysely<KyselyDatabase>` argument — the same convention the multi-row
 * transaction helpers already follow (see `.claude/rules/database-patterns.md`
 * and `conventions-services.md`).
 *
 * We flag the CONSTRUCTION primitives, not imports: `import type { Kysely,
 * KyselyDatabase }` and `import { sql } from "kysely"` are ordinary, allowed
 * service-layer imports and must never trip this. `.server.ts` files (the
 * sanctioned home for a client) and route actions (which legitimately call
 * `getDatabaseClient()`) are out of scope — only `*.service.ts` is scanned.
 */
const MESSAGE =
  "A *.service.ts must not construct a DB pool/Kysely client — this file is bundled for the browser via the module barrel. Build it in a .server file (getDatabaseClient in ~/services/database.server) and pass it into the service as a `db: Kysely<KyselyDatabase>` argument from the route action.";

const BANNED = [
  { pattern: /getPostgresConnectionPool\s*\(/g, message: MESSAGE },
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
