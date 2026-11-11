// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { pack } from "tar-stream";
import { describe, expect, it } from "vitest";
import { isUserBackupName, unpackBackupArchive } from "./settings.service";

const manifest = {
  kind: "carbon-company-backup",
  version: 1,
  schemaVersion: "20260101000000",
  sourceCompanyId: "co",
  sourceCompanyGroupId: null,
  sourceCompanyName: null,
  exportedAt: "2026-01-01T00:00:00.000Z",
  exportedBy: "user",
  label: null,
  includeStorage: "none",
  tables: [{ name: "item", rows: 2, columns: ["id"] }],
  storage: [],
  excludedTables: []
};

async function archive(
  entries: Array<{ name: string; body?: Buffer | string; type?: "directory" }>
): Promise<Readable> {
  const tar = pack();
  for (const e of entries) {
    if (e.type) tar.entry({ name: e.name, type: e.type });
    else tar.entry({ name: e.name }, e.body ?? "");
  }
  tar.finalize();
  const chunks: Buffer[] = [];
  for await (const c of tar) chunks.push(c as Buffer);
  return Readable.from([gzipSync(Buffer.concat(chunks))]);
}

/** A bucket that records uploads in order and lists/removes what it holds. */
function fakeStorage() {
  const files = new Map<string, Buffer>();
  const uploads: string[] = [];
  const bucket = {
    upload: async (path: string, body: Buffer) => {
      uploads.push(path);
      files.set(path, body);
      return { error: null };
    },
    list: async (prefix: string) => {
      const names = new Set<string>();
      const data: Array<{ name: string; id: string | null }> = [];
      for (const path of files.keys()) {
        if (!path.startsWith(`${prefix}/`)) continue;
        const [head, ...rest] = path.slice(prefix.length + 1).split("/");
        if (names.has(head)) continue;
        names.add(head);
        data.push({ name: head, id: rest.length ? null : head });
      }
      return { data, error: null };
    },
    remove: async (paths: string[]) => {
      for (const p of paths) files.delete(p);
      return { error: null };
    }
  };
  const client = { storage: { from: () => bucket } } as never;
  return { client, files, uploads };
}

describe("unpackBackupArchive", () => {
  it("accepts a ./-prefixed archive and uploads the manifest last", async () => {
    const { client, uploads } = fakeStorage();
    const { name } = await unpackBackupArchive(
      client,
      "co",
      await archive([
        { name: "./", type: "directory" },
        { name: "./manifest.json", body: JSON.stringify(manifest) },
        { name: "./tables/item.ndjson.gz", body: "x" }
      ])
    );
    expect(uploads).toEqual([
      `exports/${name}/tables/item.ndjson.gz`,
      `exports/${name}/manifest.json`
    ]);
  });

  it("counts a multi-part table's extra files", async () => {
    const { client } = fakeStorage();
    const parts = {
      ...manifest,
      tables: [{ ...manifest.tables[0], parts: 2 }]
    };
    await expect(
      unpackBackupArchive(
        client,
        "co",
        await archive([
          { name: "manifest.json", body: JSON.stringify(parts) },
          { name: "tables/item.ndjson.gz", body: "x" }
        ])
      )
    ).rejects.toThrow(/missing table data for item/);
    await expect(
      unpackBackupArchive(
        client,
        "co",
        await archive([
          { name: "manifest.json", body: JSON.stringify(parts) },
          { name: "tables/item.ndjson.gz", body: "x" },
          { name: "tables/item.1.ndjson.gz", body: "x" }
        ])
      )
    ).resolves.toBeTruthy();
  });

  it("removes the half-written folder when a listed table is missing", async () => {
    const { client, files } = fakeStorage();
    await expect(
      unpackBackupArchive(
        client,
        "co",
        await archive([
          { name: "manifest.json", body: JSON.stringify(manifest) },
          { name: "assets/a.png", body: "x" }
        ])
      )
    ).rejects.toThrow(/missing table data/);
    expect(files.size).toBe(0);
  });

  it("refuses a manifest of the wrong shape", async () => {
    const { client, files } = fakeStorage();
    await expect(
      unpackBackupArchive(
        client,
        "co",
        await archive([{ name: "manifest.json", body: '{"tables":"x"}' }])
      )
    ).rejects.toThrow(/unreadable manifest/);
    expect(files.size).toBe(0);
  });

  it("aborts on an entry past the bucket's object limit", async () => {
    const { client, files } = fakeStorage();
    await expect(
      unpackBackupArchive(
        client,
        "co",
        await archive([
          { name: "tables/item.ndjson.gz", body: "x" },
          {
            name: "tables/big.ndjson.gz",
            body: Buffer.alloc(50 * 1024 * 1024 + 1)
          }
        ])
      )
    ).rejects.toThrow(/larger than/);
    expect(files.size).toBe(0);
  });
});

describe("isUserBackupName", () => {
  it("accepts what newBackupName makes", () => {
    expect(isUserBackupName("2026-11-11T10-20-30-123Z_uploaded")).toBe(true);
  });

  it.each([
    "_pre-restore-abc",
    "%5Fpre-restore-abc",
    "a%2Fb",
    "a/b",
    'a"b',
    "ü",
    "",
    ".."
  ])("refuses %j", (name) => {
    expect(isUserBackupName(name)).toBe(false);
  });
});
