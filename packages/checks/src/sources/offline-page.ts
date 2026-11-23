// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "../check";
import {
  OFFLINE_APPS,
  type OfflinePageSources
} from "../conformance/offline-page-cache-bumped";

/** Each app's offline.html and service-worker.js, for `findStaleOfflinePageCaches`. */
export function loadOfflinePageSources(root: string): OfflinePageSources {
  const load = (file: string): SourceFile => ({
    file,
    contents: readFileSync(join(root, file), "utf-8")
  });
  return {
    erp: {
      page: load(OFFLINE_APPS.erp.page),
      worker: load(OFFLINE_APPS.erp.worker)
    },
    mes: {
      page: load(OFFLINE_APPS.mes.page),
      worker: load(OFFLINE_APPS.mes.worker)
    }
  };
}
