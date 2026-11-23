// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import type { SourceFile, Violation } from "../check";

export const OFFLINE_PAGE_CACHE_BUMPED = "offline-page-cache-bumped";

const PIN_FILE = "packages/checks/src/conformance/offline-page-cache-bumped.ts";

/** Each app's offline page, the worker that caches it, and the constant that names the cache. */
export const OFFLINE_APPS = {
  erp: {
    page: "apps/erp/public/offline.html",
    worker: "apps/erp/public/service-worker.js",
    constant: "OFFLINE_CACHE"
  },
  mes: {
    page: "apps/mes/public/offline.html",
    worker: "apps/mes/public/service-worker.js",
    constant: "SHELL_CACHE"
  }
} as const;

export type OfflineApp = keyof typeof OFFLINE_APPS;

/**
 * The offline page both apps serve, and the cache names the workers were
 * bumped to for it. A worker saves offline.html only when it installs, and it
 * installs only when service-worker.js changes: a new page without new cache
 * names stays invisible to every browser that has the worker.
 */
export const OFFLINE_PAGE: {
  sha256: string;
  caches: Record<OfflineApp, string>;
} = {
  sha256: "82d00b39fa70f0c33ec54fa8b98480bc42cfb4dfd37d28decd89181b8ff3f2de",
  caches: { erp: "erp-offline-v5", mes: "mes-shell-v5" }
};

export type OfflinePageSources = Record<
  OfflineApp,
  { page: SourceFile; worker: SourceFile }
>;

const APPS = Object.keys(OFFLINE_APPS) as OfflineApp[];

/** "erp-offline-v5" → "erp-offline-v6"; a name without a version gets one. */
function nextCacheName(name: string): string {
  const match = name.match(/^(.*-v)(\d+)$/);
  return match ? `${match[1]}${Number(match[2]) + 1}` : `${name}-v2`;
}

function lineOf(contents: string, text: string): number {
  const index = contents.indexOf(text);
  return index === -1 ? 0 : contents.slice(0, index).split("\n").length;
}

/**
 * Both apps' offline.html match the pinned page, so ERP and MES serve the
 * same one, and each worker declares the cache name pinned with it.
 */
export function findStaleOfflinePageCaches(
  sources: OfflinePageSources,
  pinned: typeof OFFLINE_PAGE = OFFLINE_PAGE
): Violation[] {
  const bumps = APPS.map(
    (app) =>
      `${OFFLINE_APPS[app].constant} in ${OFFLINE_APPS[app].worker} to "${nextCacheName(pinned.caches[app])}"`
  ).join(" and ");
  const out: Violation[] = [];

  for (const app of APPS) {
    const { page } = sources[app];
    const sha256 = createHash("sha256").update(page.contents).digest("hex");
    if (sha256 !== pinned.sha256) {
      out.push({
        file: page.file,
        line: 1,
        snippet: `sha256 ${sha256}`,
        message: `offline.html changed, so browsers that have the worker keep the old page until its cache is renamed. Bump ${bumps}, copy the page so both apps serve the same file, then set OFFLINE_PAGE in ${PIN_FILE} to sha256 "${sha256}" and the new cache names.`
      });
    }
  }

  for (const app of APPS) {
    const { worker } = sources[app];
    const { constant } = OFFLINE_APPS[app];
    const declaration = `const ${constant} = "${pinned.caches[app]}";`;
    if (!worker.contents.includes(declaration)) {
      out.push({
        file: worker.file,
        line: lineOf(worker.contents, `const ${constant} =`),
        snippet: declaration,
        message: `${worker.file} no longer declares ${declaration} If it was bumped for a new offline.html, set OFFLINE_PAGE in ${PIN_FILE} to the new page's sha256 and cache names.`
      });
    }
  }

  return out;
}
