// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  findStaleOfflinePageCaches,
  type OfflinePageSources
} from "./offline-page";

// Computed with `shasum -a 256`, not by the code under test.
const PAGE = "<p>Offline</p>";
const PAGE_SHA256 =
  "ce53a2ab0e456d4f8189945bf64ba13093c20ead35e8831abc86d76c0454b668";
const EDITED_PAGE = "<p>Offline!</p>";
const EDITED_SHA256 =
  "349ee485babf6eed5f92443d5cc3e4ccbedded9960c07df50b0001f8d176cf04";

const pinned = {
  sha256: PAGE_SHA256,
  caches: { erp: "erp-offline-v5", mes: "mes-shell-v5" }
};

function offlineSources(
  overrides: {
    erpPage?: string;
    mesPage?: string;
    erpWorker?: string;
    mesWorker?: string;
  } = {}
): OfflinePageSources {
  return {
    erp: {
      page: { file: "erp/offline.html", contents: overrides.erpPage ?? PAGE },
      worker: {
        file: "erp/service-worker.js",
        contents:
          overrides.erpWorker ?? 'const OFFLINE_CACHE = "erp-offline-v5";\n'
      }
    },
    mes: {
      page: { file: "mes/offline.html", contents: overrides.mesPage ?? PAGE },
      worker: {
        file: "mes/service-worker.js",
        contents:
          overrides.mesWorker ??
          '// shell\nconst SHELL_CACHE = "mes-shell-v5";\n'
      }
    }
  };
}

const found = (input: OfflinePageSources) =>
  findStaleOfflinePageCaches(input, pinned).map(
    (v) => `${v.file}:${v.line} ${v.snippet}`
  );

describe("findStaleOfflinePageCaches", () => {
  it("accepts the pinned page in both apps with the pinned cache names", () => {
    expect(found(offlineSources())).toEqual([]);
  });

  it("flags an edited page and names the cache names to bump to", () => {
    const violations = findStaleOfflinePageCaches(
      offlineSources({ erpPage: EDITED_PAGE, mesPage: EDITED_PAGE }),
      pinned
    );
    expect(violations.map((v) => `${v.file} ${v.snippet}`)).toEqual([
      `erp/offline.html sha256 ${EDITED_SHA256}`,
      `mes/offline.html sha256 ${EDITED_SHA256}`
    ]);
    expect(violations[0]?.message).toContain(
      'OFFLINE_CACHE in apps/erp/public/service-worker.js to "erp-offline-v6"'
    );
    expect(violations[0]?.message).toContain(
      'SHELL_CACHE in apps/mes/public/service-worker.js to "mes-shell-v6"'
    );
  });

  it("flags a page changed in one app only, so ERP and MES serve the same page", () => {
    expect(found(offlineSources({ mesPage: EDITED_PAGE }))).toEqual([
      `mes/offline.html:1 sha256 ${EDITED_SHA256}`
    ]);
  });

  it("flags a worker whose cache name is not the one pinned with the page", () => {
    expect(
      found(
        offlineSources({
          mesWorker: '// shell\nconst SHELL_CACHE = "mes-shell-v6";\n'
        })
      )
    ).toEqual(['mes/service-worker.js:2 const SHELL_CACHE = "mes-shell-v5";']);
  });
});
