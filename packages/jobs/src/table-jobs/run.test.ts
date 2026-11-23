// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { planIdSlices } from "./bulk";
import { applyIdSlice, collectIds, storeSelectedIds } from "./bulk-run";
import { MAX_EXPORT_ROWS } from "./csv";
import {
  composeExport,
  removeExportParts,
  writeExportPart
} from "./export-run";
import type {
  TableBulkActionCounts,
  TableJobHandlers,
  TableJobPage
} from "./handlers";
import {
  readListPages,
  TABLE_JOB_PAGE_SIZE,
  TABLE_JOB_ROWS_PER_STEP
} from "./paging";
import type { TableJobStorage } from "./storage";

/**
 * The step bodies of the two table jobs, run against a list of plain rows (the
 * ERP's list registry is the boundary) and a storage held in a Map (the
 * bucket is the boundary). Each test checks what a step leaves behind: the
 * file it wrote, the counts it returned, the cursor the next step starts from.
 */

const context = { companyId: "co_1", userId: "user_1" };

/** A list of `total` rows `{ id, name }`, paged by a numeric cursor. */
function listOf(total: number, options: { failAt?: number } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({
    id: `row_${i}`,
    name: `Row ${i}`
  }));
  const handlers: Pick<TableJobHandlers, "fetchListPage" | "listIdColumn"> = {
    async fetchListPage(_listKey, _context, _search, page) {
      const start = page.cursor === null ? 0 : Number(page.cursor);
      if (options.failAt !== undefined && start >= options.failAt) {
        return { rows: [], nextCursor: null, error: "boom" } as TableJobPage;
      }
      const slice = rows.slice(start, start + page.limit);
      const end = start + slice.length;
      return { rows: slice, nextCursor: end < total ? String(end) : null };
    },
    listIdColumn: () => "id"
  };
  return handlers;
}

function memoryStorage(options: { failDownload?: boolean } = {}) {
  const files = new Map<string, Uint8Array>();
  const storage: TableJobStorage = {
    async upload(key, body) {
      files.set(
        key,
        typeof body === "string"
          ? new TextEncoder().encode(body)
          : new Uint8Array(await new Response(body).arrayBuffer())
      );
    },
    async download(key) {
      const file = files.get(key);
      if (options.failDownload || !file) throw new Error(`No file ${key}`);
      return file;
    },
    async remove(keys) {
      for (const key of keys) files.delete(key);
    }
  };
  const text = (key: string) =>
    new TextDecoder().decode(files.get(key) ?? new Uint8Array());
  return { storage, files, text };
}

describe("readListPages", () => {
  it("stops after one step's pages and hands back the cursor", async () => {
    const pages: number[] = [];
    const result = await readListPages({
      handlers: listOf(TABLE_JOB_ROWS_PER_STEP + 10),
      listKey: "parts",
      context,
      search: "",
      cursor: null,
      rowsBefore: 0,
      maxRows: MAX_EXPORT_ROWS,
      onPage: (rows) => {
        pages.push(rows.length);
      }
    });
    expect(result).toEqual({
      rows: TABLE_JOB_ROWS_PER_STEP,
      nextCursor: String(TABLE_JOB_ROWS_PER_STEP),
      truncated: false
    });
    expect(pages.every((size) => size === TABLE_JOB_PAGE_SIZE)).toBe(true);
  });

  it("stops at the row limit counted across steps", async () => {
    const result = await readListPages({
      handlers: listOf(5_000),
      listKey: "parts",
      context,
      search: "",
      cursor: "1000",
      rowsBefore: 1_000,
      maxRows: 2_000,
      onPage: () => undefined
    });
    expect(result).toEqual({ rows: 1_000, nextCursor: null, truncated: true });
  });

  it("is not truncated when the list ends exactly at the limit", async () => {
    const result = await readListPages({
      handlers: listOf(2_000),
      listKey: "parts",
      context,
      search: "",
      cursor: null,
      rowsBefore: 0,
      maxRows: 2_000,
      onPage: () => undefined
    });
    expect(result).toEqual({ rows: 2_000, nextCursor: null, truncated: false });
  });

  it("throws when a page cannot be read", async () => {
    await expect(
      readListPages({
        handlers: listOf(2_000, { failAt: 500 }),
        listKey: "parts",
        context,
        search: "",
        cursor: null,
        rowsBefore: 0,
        maxRows: 2_000,
        onPage: () => undefined
      })
    ).rejects.toThrow('Failed to read the list "parts"');
  });
});

describe("the export steps", () => {
  const columns = [
    { key: "id", label: "Part" },
    { key: "name", label: "Name" }
  ];

  async function runExport(total: number) {
    const { storage, files, text } = memoryStorage();
    const handlers = listOf(total);
    const partKeys: string[] = [];
    let cursor: string | null = null;
    let rows = 0;
    let bytes = 0;
    for (let part = 0; ; part++) {
      const key = `parts/${part}.csv`;
      const result = await writeExportPart(
        { handlers, storage },
        {
          context,
          listKey: "parts",
          search: "",
          columns,
          cursor,
          part,
          rowsBefore: rows,
          bytesBefore: bytes,
          key
        }
      );
      partKeys.push(key);
      rows += result.rows;
      bytes += result.bytes;
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    await composeExport({ storage }, { partKeys, key: "export.csv" });
    await removeExportParts({ storage }, { partKeys, key: "export.csv" });
    return { files, text, partKeys, rows };
  }

  it("joins the parts into one file with one header and every row", async () => {
    const total = TABLE_JOB_ROWS_PER_STEP * 2 + 3;
    const { text, files, partKeys, rows } = await runExport(total);
    expect(partKeys).toHaveLength(3);
    expect(rows).toBe(total);

    const lines = text("export.csv").split("\r\n");
    expect(lines[0]).toBe("Part,Name");
    expect(lines).toHaveLength(total + 1);
    expect(lines[1]).toBe("row_0,Row 0");
    expect(lines[total]).toBe(`row_${total - 1},Row ${total - 1}`);
    // The parts are deleted once the export is written.
    expect([...files.keys()]).toEqual(["export.csv"]);
  });

  it("writes the same file when compose runs again before the parts are removed", async () => {
    const { storage, text } = memoryStorage();
    const partKeys = ["parts/0.csv", "parts/1.csv"];
    await storage.upload(partKeys[0]!, "Part,Name\r\nrow_0,Row 0", "text/csv");
    await storage.upload(partKeys[1]!, "\r\nrow_1,Row 1", "text/csv");

    await composeExport({ storage }, { partKeys, key: "export.csv" });
    await composeExport({ storage }, { partKeys, key: "export.csv" });

    expect(text("export.csv")).toBe("Part,Name\r\nrow_0,Row 0\r\nrow_1,Row 1");
  });

  it("writes the header alone for an empty list", async () => {
    const { text } = await runExport(0);
    expect(text("export.csv")).toBe("Part,Name");
  });
});

describe("the bulk action steps", () => {
  async function collectAll(total: number, maxRows: number) {
    const { storage, text } = memoryStorage();
    const handlers = listOf(total);
    const idsPerFile: number[] = [];
    let cursor: string | null = null;
    let rows = 0;
    let truncated = false;
    for (let file = 0; ; file++) {
      const result = await collectIds(
        { handlers, storage },
        {
          context,
          listKey: "jobs",
          search: "",
          cursor,
          rowsBefore: rows,
          maxRows,
          key: `ids/${file}.json`
        }
      );
      idsPerFile.push(result.ids);
      rows += result.rows;
      truncated = result.truncated;
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return { storage, text, idsPerFile, truncated };
  }

  it("stores each step's ids in its own file, in list order", async () => {
    const { text, idsPerFile, truncated } = await collectAll(
      TABLE_JOB_ROWS_PER_STEP + 5,
      100_000
    );
    expect(idsPerFile).toEqual([TABLE_JOB_ROWS_PER_STEP, 5]);
    expect(truncated).toBe(false);
    const second = JSON.parse(text("ids/1.json"));
    expect(second[0]).toBe(`row_${TABLE_JOB_ROWS_PER_STEP}`);
  });

  it("stops at the action's row limit and says so", async () => {
    const { idsPerFile, truncated } = await collectAll(5_000, 2_000);
    expect(idsPerFile).toEqual([2_000]);
    expect(truncated).toBe(true);
  });

  it("acts on every collected id exactly once across the slices", async () => {
    const { storage, idsPerFile } = await collectAll(
      TABLE_JOB_ROWS_PER_STEP + 250,
      100_000
    );
    const seen: string[] = [];
    const handlers: Pick<TableJobHandlers, "runBulkAction"> = {
      async runBulkAction(_action, ids) {
        seen.push(...ids);
        return { done: ids.length, skipped: 0, failed: 0 };
      }
    };
    let total: TableBulkActionCounts = { done: 0, skipped: 0, failed: 0 };
    for (const slice of planIdSlices(idsPerFile, 1_000)) {
      const counts = await applyIdSlice(
        { handlers, storage },
        {
          context,
          action: { key: "jobs.delete", params: {} },
          key: `ids/${slice.file}.json`,
          start: slice.start,
          end: slice.end,
          chunkSize: 100
        }
      );
      total = {
        done: total.done + counts.done,
        skipped: total.skipped + counts.skipped,
        failed: total.failed + counts.failed
      };
    }
    expect(total.done).toBe(TABLE_JOB_ROWS_PER_STEP + 250);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(TABLE_JOB_ROWS_PER_STEP + 250);
  });

  it("hands the carry from chunk to chunk and from slice to slice", async () => {
    const { storage, idsPerFile } = await collectAll(60, 100_000);
    // Each call sees the carry the call before it returned.
    const seenCarries: unknown[] = [];
    const handlers: Pick<TableJobHandlers, "runBulkAction"> = {
      async runBulkAction(_action, ids, _context, carry) {
        seenCarries.push(carry?.calls ?? null);
        const calls = ((carry?.calls as number | undefined) ?? 0) + 1;
        return { done: ids.length, skipped: 0, failed: 0, carry: { calls } };
      }
    };
    let carry: Record<string, unknown> | undefined;
    for (const slice of planIdSlices(idsPerFile, 25)) {
      const result = await applyIdSlice(
        { handlers, storage },
        {
          context,
          action: { key: "jobs.release", params: {} },
          key: `ids/${slice.file}.json`,
          start: slice.start,
          end: slice.end,
          chunkSize: 10,
          carry
        }
      );
      carry = result.carry;
    }
    // 60 ids: slices of 25, 25, 10; chunks of 10 -> 7 calls in a row.
    expect(seenCarries).toEqual([null, 1, 2, 3, 4, 5, 6]);
    expect(carry).toEqual({ calls: 7 });
  });

  it("counts a failed chunk as failed and runs the rest", async () => {
    const { storage, idsPerFile } = await collectAll(250, 100_000);
    let call = 0;
    const handlers: Pick<TableJobHandlers, "runBulkAction"> = {
      async runBulkAction(_action, ids) {
        call += 1;
        if (call === 2) throw new Error("chunk failed");
        return { done: ids.length - 1, skipped: 1, failed: 0 };
      }
    };
    const [slice] = planIdSlices(idsPerFile, 1_000);
    const counts = await applyIdSlice(
      { handlers, storage },
      {
        context,
        action: { key: "jobs.delete", params: {} },
        key: "ids/0.json",
        start: slice!.start,
        end: slice!.end,
        chunkSize: 100
      }
    );
    // Chunks of 100, 100 and 50: the second throws.
    expect(counts).toEqual({ done: 99 + 49, skipped: 2, failed: 100 });
  });

  it("counts the whole slice as failed when its ids cannot be read", async () => {
    const { storage } = memoryStorage({ failDownload: true });
    const counts = await applyIdSlice(
      {
        handlers: {
          runBulkAction: async () => ({ done: 1, skipped: 0, failed: 0 })
        },
        storage
      },
      {
        context,
        action: { key: "jobs.delete", params: {} },
        key: "ids/0.json",
        start: 1_000,
        end: 1_250,
        chunkSize: 100
      }
    );
    expect(counts).toEqual({ done: 0, skipped: 0, failed: 250 });
  });
});

describe("storeSelectedIds", () => {
  it("stores the selected ids once each, and acts on exactly those", async () => {
    const { storage } = memoryStorage();
    const stored = await storeSelectedIds(
      { storage },
      { ids: ["j1", "j2", "", "j1", "j3"], maxRows: 2_000, key: "ids/0.json" }
    );
    expect(stored).toEqual({ ids: 3, truncated: false });

    const seen: string[] = [];
    const counts = await applyIdSlice(
      {
        handlers: {
          async runBulkAction(_action, ids) {
            seen.push(...ids);
            return { done: ids.length, skipped: 0, failed: 0 };
          }
        },
        storage
      },
      {
        context,
        action: { key: "jobs.release", params: {} },
        key: "ids/0.json",
        start: 0,
        end: stored.ids,
        chunkSize: 25
      }
    );
    expect(seen).toEqual(["j1", "j2", "j3"]);
    expect(counts.done).toBe(3);
  });

  it("keeps at most maxRows ids and says so", async () => {
    const { storage } = memoryStorage();
    const stored = await storeSelectedIds(
      { storage },
      { ids: ["a", "b", "c"], maxRows: 2, key: "ids/0.json" }
    );
    expect(stored).toEqual({ ids: 2, truncated: true });
  });
});

describe("which page reads ask for the export's rows", () => {
  it("asks when writing an export part, never when collecting ids", async () => {
    const forExport: Array<boolean | undefined> = [];
    const base = listOf(3);
    const handlers: Pick<TableJobHandlers, "fetchListPage" | "listIdColumn"> = {
      ...base,
      async fetchListPage(listKey, readContext, search, page) {
        forExport.push(page.forExport);
        return base.fetchListPage(listKey, readContext, search, page);
      }
    };
    const { storage } = memoryStorage();

    await writeExportPart(
      { handlers, storage },
      {
        context,
        listKey: "jobs",
        search: "",
        columns: [{ key: "id", label: "Id" }],
        cursor: null,
        part: 0,
        rowsBefore: 0,
        bytesBefore: 0,
        key: "parts/0.csv"
      }
    );
    await collectIds(
      { handlers, storage },
      {
        context,
        listKey: "jobs",
        search: "",
        cursor: null,
        rowsBefore: 0,
        maxRows: 100,
        key: "ids/0.json"
      }
    );

    expect(forExport).toEqual([true, undefined]);
  });
});
