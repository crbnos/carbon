// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Check } from "../check";
import { pluginFindings } from "../sources/inputs";

const ID = "route-action-shape";

/**
 * The rule itself is a Biome plugin, `biome-plugins/routeActionShape.grit`,
 * so the editor shows it; this reads what the plugin reports.
 *
 * It fails a write in an ERP route: a `.from(…)` insert, upsert, update or
 * delete, a Kysely `insertInto`/`updateTable`/`deleteFrom`, or an
 * `invokePosting(`/`invokePostingOrThrow(`/`invokeCreate(` call (a posting
 * body run outside its service function). The write belongs in a
 * `defineServiceFn` the route calls, so the API and MCP run the same logic
 * (`.ai/plans/2026-10-15-service-function-migration.md`).
 *
 * Biome matches the parsed call. So a comment or a line break inside the
 * chain does not hide a write, and a write named in a comment or a string
 * does not match. A route that calls a write building block from a
 * `.service.ts` is not detected. The root `biome.jsonc` enables the plugin for
 * ERP routes and leaves out test files. The baseline holds auth routes only
 * (the OAuth routes, invite, unlock, account security and passkeys).
 */
export const routeActionShape: Check = {
  id: ID,
  description:
    "An ERP route writes only through a service function: no client, Kysely or posting writes in the route",
  provenance: {
    deprecates: "a route action that composes writes itself",
    replacedBy:
      "one `defineServiceFn` per operation, called through `authorize(request)`",
    since: "2026-10-15"
  },
  find: (repo) =>
    repo
      .read(pluginFindings)
      .filter((finding) => finding.checkId === ID)
      .map((finding) => finding.violation)
};
