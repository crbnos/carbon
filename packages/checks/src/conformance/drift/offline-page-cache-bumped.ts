// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import { defineCheck, type Violation } from "../../check";
import { read } from "../../sources/read-source";
import { lineOf } from "../../sources/text";

/**
 * A worker saves `offline.html` only when it installs. It installs only when
 * its own file changes. So an edited page with no renamed cache never reaches
 * a browser that already has the worker.
 *
 * Both apps share one pinned hash, so ERP and MES keep serving the same page.
 * The message names the next cache names and the new sha256: update `pinned`
 * in this file in the same change. See `.claude/rules/service-workers.md`.
 *
 * Do not baseline a finding. The snippet carries the page's hash, so a
 * baseline entry could never match a later edit.
 */
export const offlinePageCacheBumped = defineCheck({
  id: "offline-page-cache-bumped",
  description:
    "A worker re-caches offline.html only when it reinstalls, which takes a change to service-worker.js: a new page needs new cache names.",
  reads: {
    apps: (root) => ({
      erp: {
        page: read(root, "apps/erp/public/offline.html"),
        worker: read(root, "apps/erp/public/service-worker.js"),
        constant: "OFFLINE_CACHE"
      },
      mes: {
        page: read(root, "apps/mes/public/offline.html"),
        worker: read(root, "apps/mes/public/service-worker.js"),
        constant: "SHELL_CACHE"
      }
    }),
    pinned: () => ({
      sha256:
        "82d00b39fa70f0c33ec54fa8b98480bc42cfb4dfd37d28decd89181b8ff3f2de",
      caches: { erp: "erp-offline-v5", mes: "mes-shell-v5" }
    })
  },
  rule() {
    const pinFile =
      "packages/checks/src/conformance/drift/offline-page-cache-bumped.ts";

    function nextCacheName(name: string): string {
      const match = name.match(/^(.*-v)(\d+)$/);
      return match ? `${match[1]}${Number(match[2]) + 1}` : `${name}-v2`;
    }

    const names = ["erp", "mes"] as const;

    return ({ apps, pinned }) => {
      const bumps = names
        .map(
          (app) =>
            `${apps[app].constant} in ${apps[app].worker.file} to "${nextCacheName(pinned.caches[app])}"`
        )
        .join(" and ");
      const out: Violation[] = [];

      for (const app of names) {
        const { page } = apps[app];
        const sha256 = createHash("sha256").update(page.contents).digest("hex");
        if (sha256 !== pinned.sha256) {
          out.push({
            file: page.file,
            line: 1,
            snippet: `sha256 ${sha256}`,
            message: `offline.html changed, so browsers that have the worker keep the old page until its cache is renamed. Bump ${bumps}, copy the page so both apps serve the same file, then set pinned in ${pinFile} to sha256 "${sha256}" and the new cache names.`
          });
        }
      }

      for (const app of names) {
        const { worker, constant } = apps[app];
        const declaration = `const ${constant} = "${pinned.caches[app]}";`;
        if (!worker.contents.includes(declaration)) {
          const at = worker.contents.indexOf(`const ${constant} =`);
          out.push({
            file: worker.file,
            line: at === -1 ? 0 : lineOf(worker.contents, at),
            snippet: declaration,
            message: `${worker.file} no longer declares ${declaration} If it was bumped for a new offline.html, set pinned in ${pinFile} to the new page's sha256 and cache names.`
          });
        }
      }

      return out;
    };
  }
});
