// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck } from "../../check";
import {
  findStaleOfflinePageCaches,
  loadOfflinePageSources
} from "../../sources/offline-page";

/**
 * Fails when either app's `offline.html` does not hash to
 * `OFFLINE_PAGE.sha256`, or when a `service-worker.js` does not declare the
 * cache name pinned with it. A worker saves the page only when it installs.
 * It installs only when its own file changes. So an edited page with no renamed
 * cache never reaches a browser that already has the worker.
 *
 * Both apps share one pinned hash, so ERP and MES keep serving the same page.
 * The message names the next cache names and the new sha256: update
 * `OFFLINE_PAGE` in `src/sources/offline-page.ts` in the same change. See
 * `.claude/rules/service-workers.md`.
 *
 * Do not baseline a finding. The snippet carries the page's hash, so a
 * baseline entry could never match a later edit.
 */
export const offlinePageCacheBumped = defineCheck({
  id: "offline-page-cache-bumped",
  description:
    "A worker re-caches offline.html only when it reinstalls, which takes a change to service-worker.js: a new page needs new cache names.",
  reads: { sources: loadOfflinePageSources },
  find: ({ sources }) => findStaleOfflinePageCaches(sources)
});
