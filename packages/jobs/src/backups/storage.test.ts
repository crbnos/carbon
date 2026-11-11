// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { gzipSync } from "node:zlib";
import { NonRetriableError } from "inngest";
import { describe, expect, it } from "vitest";
import {
  BACKUP_KIND,
  backupAssetsDir,
  backupManifestPath,
  backupTablePath,
  type Manifest
} from "./format";
import {
  assetTargets,
  deleteCompanyFiles,
  listBackups,
  readBackup,
  restoreAssetsFromBackup
} from "./storage";

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

describe("assetTargets", () => {
  it("drops a manifest path that would land outside the company's folder", () => {
    const keep = "co/parts/item_1/drawing.pdf";
    const targets = assetTargets({
      files: [
        { path: keep, included: true },
        { path: "co/%2e%2e/%2e%2e/other-bucket/x.pdf", included: true },
        { path: "co/../other/x.pdf", included: true },
        { path: "exports/older-backup/manifest.json", included: true },
        { path: "co/not-included.pdf", included: false }
      ],
      sourceCompanyId: "co",
      companyId: "co",
      idRewrite: new Map()
    });
    expect(targets).toEqual([{ source: keep, target: keep }]);
  });
});

/** A bucket of objects that can be listed, downloaded and removed. */
function fakeBucket(objects: Map<string, string | Buffer>) {
  const removed: string[][] = [];
  const notFound = { message: "Object not found", statusCode: "404" };
  const api = {
    async list(prefix: string, opts: { limit: number; offset: number }) {
      const base = prefix ? `${prefix}/` : "";
      const entries = new Map<string, { name: string; id: string | null }>();
      for (const key of objects.keys()) {
        if (!key.startsWith(base)) continue;
        const [head, ...more] = key.slice(base.length).split("/");
        entries.set(head!, { name: head!, id: more.length ? null : head! });
      }
      const page = [...entries.values()].slice(
        opts.offset,
        opts.offset + opts.limit
      );
      return { data: page, error: null };
    },
    download(path: string) {
      const body = objects.get(path);
      const result =
        body === undefined
          ? { data: null, error: notFound }
          : { data: new Blob([body.toString()]), error: null };
      return {
        then: (resolve: (r: typeof result) => void) => resolve(result),
        asStream: async () =>
          body === undefined
            ? { data: null, error: notFound }
            : { data: [Buffer.from(body)], error: null }
      };
    },
    async remove(paths: string[]) {
      removed.push(paths);
      for (const p of paths) objects.delete(p);
      return { data: [], error: null };
    }
  };
  return { client: { storage: { from: () => api } } as never, removed };
}

const manifest = (tables: Manifest["tables"]): Manifest => ({
  kind: BACKUP_KIND,
  version: 1,
  schemaVersion: "1",
  sourceCompanyId: "co",
  sourceCompanyGroupId: "grp",
  sourceCompanyName: null,
  exportedAt: "2026-11-11T00:00:00Z",
  exportedBy: "user",
  label: null,
  includeStorage: "none",
  tables,
  storage: [],
  excludedTables: []
});

const ndjson = (ids: string[]) =>
  gzipSync(ids.map((id) => `${JSON.stringify({ id })}\n`).join(""));

describe("deleteCompanyFiles", () => {
  it("removes the backup's manifest before any other file", async () => {
    const objects = new Map<string, string>([
      ["exports/b1/assets/co/a.pdf", "a"],
      ["exports/b1/assets/co/manifest.json", "an asset"],
      ["exports/b1/manifest.json", "{}"],
      ["exports/b1/tables/item.ndjson.gz", "t"]
    ]);
    const { client, removed } = fakeBucket(objects);
    await deleteCompanyFiles(client, "co", "exports/b1");
    expect(removed[0]).toEqual(["exports/b1/manifest.json"]);
    expect(objects.size).toBe(0);
  });
});

describe("listBackups", () => {
  it("lists a backup with a malformed manifest as having none", async () => {
    const { client } = fakeBucket(
      new Map([
        [backupManifestPath("bad"), '{"version":1}'],
        [backupManifestPath("good"), JSON.stringify(manifest([]))]
      ])
    );
    const listed = await listBackups(client, "co");
    expect(listed.find((b) => b.name === "bad")?.manifest).toBeNull();
    expect(listed.find((b) => b.name === "good")?.manifest?.kind).toBe(
      BACKUP_KIND
    );
  });
});

describe("readBackup", () => {
  it("reads a split table's parts in order, and a one-file table as before", async () => {
    const { client } = fakeBucket(
      new Map<string, string | Buffer>([
        [
          backupManifestPath("b1"),
          JSON.stringify(
            manifest([
              { name: "item", rows: 3, columns: ["id"], parts: 2 },
              { name: "part", rows: 1, columns: ["id"] }
            ])
          )
        ],
        [backupTablePath("b1", "item"), ndjson(["i1", "i2"])],
        [backupTablePath("b1", "item", 1), ndjson(["i3"])],
        [backupTablePath("b1", "part"), ndjson(["p1"])]
      ])
    );
    const backup = await readBackup(client, "co", "b1");
    const ids = async (table: string) => {
      const out: unknown[] = [];
      for await (const batch of backup.rows(table)) {
        out.push(...batch.map((r) => r.id));
      }
      return out;
    };
    expect(await ids("item")).toEqual(["i1", "i2", "i3"]);
    expect(await ids("part")).toEqual(["p1"]);
    expect(await ids("absent")).toEqual([]);
  });

  it("refuses a malformed manifest without a retry", async () => {
    const { client } = fakeBucket(
      new Map([[backupManifestPath("bad"), '{"version":1}']])
    );
    await expect(readBackup(client, "co", "bad")).rejects.toBeInstanceOf(
      NonRetriableError
    );
  });
});
