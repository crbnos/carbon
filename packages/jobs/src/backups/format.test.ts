// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { gunzipSync, gzipSync } from "node:zlib";
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql
} from "kysely";
import { describe, expect, it } from "vitest";
import type { ColumnInfo } from "./catalog";
import {
  BACKUP_KIND,
  exportColumn,
  parseManifest,
  readTableRows,
  tableWriter
} from "./format";

async function readAll(
  bytes: Buffer,
  limits?: { lineChars: number; bytes: number }
) {
  const rows: unknown[] = [];
  for await (const batch of readTableRows([bytes], 100, limits)) {
    rows.push(...batch);
  }
  return rows;
}

describe("tableWriter / readTableRows", () => {
  it("round-trips text holding the Unicode line and paragraph separators", async () => {
    // JSON.stringify leaves U+2028/U+2029 unescaped, and Node 24's readline
    // ends a line at them, which split a row mid-string on restore.
    const rows = [
      { id: "a", notes: "pasted\u2028from a PDF\u2029and Word" },
      { id: "b", notes: "carriage\rreturn and\nnewline" }
    ];
    const writer = tableWriter();
    await writer.write(rows);
    const bytes = await writer.finish();
    const text = gunzipSync(bytes).toString("utf8");
    expect(text.split("\n")).toHaveLength(rows.length + 1);
    expect(text).not.toMatch(/[\u2028\u2029]/);
    const read = [];
    for await (const batch of readTableRows([bytes])) read.push(...batch);
    expect(read).toEqual(rows);
  });

  it("reads a table back in batches, across the writes that made it", async () => {
    const writer = tableWriter();
    for (let w = 0; w < 3; w++) {
      await writer.write(
        Array.from({ length: 4 }, (_, i) => ({ id: `${w}-${i}` }))
      );
    }
    const bytes = await writer.finish();
    // Byte by byte, so no line ever arrives in one chunk.
    const chunks = [...bytes].map((b) => new Uint8Array([b]));
    const sizes: number[] = [];
    const ids: unknown[] = [];
    for await (const batch of readTableRows(chunks, 5)) {
      sizes.push(batch.length);
      ids.push(...batch.map((r) => r.id));
    }
    expect(sizes).toEqual([5, 5, 2]);
    expect(ids).toHaveLength(12);
    expect(ids[11]).toBe("2-3");
  });
});

describe("readTableRows limits", () => {
  it("refuses a line longer than the line cap, even split across chunks", async () => {
    const bytes = gzipSync(`{"id":"a"}\n{"notes":"${"x".repeat(5000)}"}\n`);
    await expect(
      readAll(bytes, { lineChars: 1000, bytes: 1e9 })
    ).rejects.toThrow(/line over 1000 characters/);
    // An unterminated last line is held to the same cap.
    const tail = gzipSync(`{"notes":"${"x".repeat(5000)}"}`);
    await expect(
      readAll(tail, { lineChars: 1000, bytes: 1e9 })
    ).rejects.toThrow(/line over 1000 characters/);
  });

  it("refuses a file that decompresses past the byte cap", async () => {
    const line = `{"id":"${"0".repeat(100)}"}\n`;
    const bytes = gzipSync(line.repeat(1000));
    expect(bytes.length).toBeLessThan(2000);
    await expect(
      readAll(bytes, { lineChars: 1e6, bytes: 50_000 })
    ).rejects.toThrow(/decompresses to over 50000 bytes/);
    expect(await readAll(bytes, { lineChars: 1e6, bytes: 1e6 })).toHaveLength(
      1000
    );
  });
});

describe("parseManifest", () => {
  const valid = {
    kind: BACKUP_KIND,
    version: 1,
    schemaVersion: "20261101000000",
    sourceCompanyId: "co",
    sourceCompanyGroupId: "grp",
    sourceCompanyName: "Acme",
    exportedAt: "2026-11-11T00:00:00Z",
    exportedBy: "user",
    label: null,
    includeStorage: "none",
    tables: [{ name: "item", rows: 3, columns: ["id"] }],
    storage: [],
    excludedTables: []
  };

  it("reads a manifest an export wrote", () => {
    expect(parseManifest(JSON.stringify(valid))).toEqual(valid);
  });

  it("returns null for a file that is not a whole manifest", () => {
    expect(parseManifest('{"version":1}')).toBeNull();
    expect(parseManifest("not json")).toBeNull();
    expect(
      parseManifest(JSON.stringify({ ...valid, kind: "something-else" }))
    ).toBeNull();
    expect(
      parseManifest(
        JSON.stringify({ ...valid, tables: [{ name: "item", rows: "3" }] })
      )
    ).toBeNull();
  });

  it("keeps an unsupported generation, so compatibility can name it", () => {
    expect(
      parseManifest(JSON.stringify({ ...valid, version: 2 }))?.version
    ).toBe(2);
  });
});

describe("exportColumn", () => {
  const db = new Kysely<unknown>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });
  const select = (udtName: string) =>
    sql`SELECT ${exportColumn({ name: "c", udtName } as ColumnInfo)}`.compile(
      db
    ).sql;

  it("reads the types pg parses lossily as text", () => {
    // NUMERIC → float, timestamps → millisecond Date, interval → object.
    for (const udt of [
      "numeric",
      "timestamptz",
      "timestamp",
      "interval",
      "date"
    ]) {
      expect(select(udt)).toBe('SELECT "c"::text AS "c"');
    }
    expect(select("_timestamptz")).toBe('SELECT "c"::text[] AS "c"');
    expect(select("_numeric")).toBe('SELECT "c"::text[] AS "c"');
  });

  it("leaves json, bytea and id arrays as pg parses them", () => {
    for (const udt of [
      "jsonb",
      "json",
      "bytea",
      "bool",
      "int4",
      "text",
      "_text",
      "_uuid"
    ]) {
      expect(select(udt)).toBe('SELECT "c"');
    }
  });
});
