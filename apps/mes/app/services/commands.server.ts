// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Every MES command, extracted from the web route actions so the web and the
 * mobile API run ONE code path.
 *
 * This file is the barrel. The commands themselves are split by area into
 * `commands.<area>.server.ts` siblings, following MES's existing flat-services
 * convention (`operation.server.ts`, `people.server.ts`, `quality.server.ts`).
 * One file would be ~2000 lines covering unrelated domains.
 *
 * The contract every command here keeps:
 *
 *   - It returns `CommandResult<T>` (`api-result.server.ts`). The web route
 *     maps a failure to exactly the redirect, flash or `data()` it returns
 *     today; the API maps `kind` to a status. Nothing in a moved body changes.
 *   - It takes its scope as ARGUMENTS — `companyId`, the effective `userId`,
 *     `sessionUserId`, `locationId`. `userContext` is set by `userMiddleware`,
 *     registered only under `x+/_layout.tsx` and `display+/_layout.tsx`, so
 *     under `api+/` it is null.
 *   - It calls the same edge functions with the same payloads and the same
 *     client (service role where the web route uses it). An operator's rows
 *     must be indistinguishable whether they worked on a tablet or in a browser.
 *
 * Behaviour that must survive the extraction, per
 * `.claude/rules/mes-job-operation-ui.md`:
 *   - the floor gate runs BEFORE the timer reopens on the scan-start path;
 *   - the scan-complete path stays ungated (closing a timer is never blocked);
 *   - ending a batch-tagged event skips `post-production-event`;
 *   - auto-print after a completion never blocks the operation;
 *   - scrap stays ONE `issue` `jobOperationScrap` invoke;
 *   - the picking-list policies stay server-side.
 */
export * from "./commands.inspection.server";
export * from "./commands.materials.server";
export * from "./commands.picking.server";
export * from "./commands.quantities.server";
export * from "./commands.steps.server";
export * from "./commands.time.server";
export * from "./commands.timecard.server";
