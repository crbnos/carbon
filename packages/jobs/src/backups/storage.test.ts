// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { backupAssetsDir } from "./format";
import { restoreAssetsFromBackup } from "./storage";

/**
 * Storage as the API behaves: a copy onto an existing key is a 409 unless the
 * request carries `x-upsert`. Every delete is recorded, because a delete on
 * storage.objects fires `delete_orphaned_documents`.
 */
function fakeStorage(objects: Map<string, string>) {
  const removed: string[] = [];
  const from = () => {
    const headers: Record<string, string> = {};
    const api = {
      setHeader(name: string, value: string) {
        headers[name] = value;
        return api;
      },
      async copy(src: string, dest: string) {
        if (objects.has(dest) && headers["x-upsert"] !== "true") {
          return {
            data: null,
            error: { message: "The resource already exists (409)" }
          };
        }
        objects.set(dest, objects.get(src)!);
        return { data: { path: dest }, error: null };
      },
      async remove(paths: string[]) {
        for (const p of paths) {
          removed.push(p);
          objects.delete(p);
        }
        return { data: [], error: null };
      }
    };
    return api;
  };
  return { client: { storage: { from } } as never, removed };
}

describe("restoreAssetsFromBackup", () => {
  it("overwrites a file that already exists without deleting it first", async () => {
    const co = "co";
    const path = `${co}/parts/item_1/drawing.pdf`;
    const objects = new Map([
      [path, "current"],
      [`${backupAssetsDir("b1")}/${path}`, "from backup"]
    ]);
    const { client, removed } = fakeStorage(objects);

    const result = await restoreAssetsFromBackup(client, {
      files: [{ path, included: true }],
      name: "b1",
      sourceCompanyId: co,
      companyId: co,
      idRewrite: new Map()
    });

    expect(result).toEqual({ copied: 1, failed: 0 });
    expect(objects.get(path)).toBe("from backup");
    expect(removed).toEqual([]);
  });
});
