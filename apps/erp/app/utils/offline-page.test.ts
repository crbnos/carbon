// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// The service worker saves public/offline.html when it installs, and it only
// reinstalls when service-worker.js changes. So a change to offline.html must
// come with a new cache name, or every browser keeps showing the old page.
//
// When this fails because offline.html changed:
// 1. bump the offline cache in BOTH apps' public/service-worker.js
//    (ERP OFFLINE_CACHE, MES SHELL_CACHE);
// 2. copy the page to the other app, so ERP and MES serve the same page;
// 3. pin the new hash and cache name here AND in the other app's copy of this
//    test (apps/{erp,mes}/app/utils/offline-page.test.ts).
const OFFLINE_PAGE_SHA256 =
  "82d00b39fa70f0c33ec54fa8b98480bc42cfb4dfd37d28decd89181b8ff3f2de";
const OFFLINE_CACHE = "erp-offline-v5";

describe("offline page", () => {
  it("ships with the cache version its worker was bumped for", () => {
    const page = read("../../public/offline.html");
    expect(createHash("sha256").update(page).digest("hex")).toBe(
      OFFLINE_PAGE_SHA256
    );
    expect(read("../../public/service-worker.js")).toContain(
      `const OFFLINE_CACHE = "${OFFLINE_CACHE}";`
    );
  });
});
