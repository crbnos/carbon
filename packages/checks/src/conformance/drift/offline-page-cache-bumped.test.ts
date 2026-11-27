// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../../sources/migrations";
import { offlinePageCacheBumped } from "./offline-page-cache-bumped";

// The rule itself is tested in `src/sources/offline-page.test.ts`; this checks
// that a finding sends the developer to the file that holds OFFLINE_PAGE.
describe("offlinePageCacheBumped", () => {
  it("names the file that holds the pinned page", () => {
    const file = (name: string) => ({ file: name, contents: "" });
    const [finding] = offlinePageCacheBumped.find({
      sources: {
        erp: { page: file("erp/offline.html"), worker: file("erp/sw.js") },
        mes: { page: file("mes/offline.html"), worker: file("mes/sw.js") }
      }
    });
    const pinFile = /set OFFLINE_PAGE in (\S+) /.exec(finding?.message ?? "");
    expect(pinFile?.[1]).toBe("packages/checks/src/sources/offline-page.ts");
    expect(existsSync(join(repoRoot(), pinFile?.[1] ?? ""))).toBe(true);
  });
});
