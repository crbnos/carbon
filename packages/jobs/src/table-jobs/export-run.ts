// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CSV_CONTENT_TYPE } from "@carbon/files/csv";
import { getLogger } from "@carbon/logger";
import {
  type ExportColumn,
  encodeExportHeader,
  encodeExportRows,
  MAX_EXPORT_BYTES,
  MAX_EXPORT_ROWS
} from "./csv";
import type { TableJobContext, TableJobHandlers } from "./handlers";
import { readListPages } from "./paging";
import type { TableJobStorage } from "./storage";

/**
 * The step bodies of the background export (`table-export.ts`). Each part
 * step reads up to 10,000 rows from its cursor and writes them as one part
 * file; the last step joins the parts into the export. The function only
 * orders the steps, so these run, and are tested, without Inngest.
 */

export type ExportDeps = {
  handlers: Pick<TableJobHandlers, "fetchListPage">;
  storage: TableJobStorage;
};

export type ExportPartResult = {
  rows: number;
  bytes: number;
  /** Where the next part starts, or null when this was the last part. */
  nextCursor: string | null;
  /** The export stopped at `MAX_EXPORT_ROWS` or `MAX_EXPORT_BYTES`. */
  truncated: boolean;
};

const log = getLogger("jobs", "table-export");

const encoder = new TextEncoder();

/**
 * Writes one part. Part 0 starts with the header line; every page starts
 * with its own line end, so the parts join without a separator.
 */
export async function writeExportPart(
  deps: ExportDeps,
  args: {
    context: TableJobContext;
    listKey: string;
    search: string;
    columns: ExportColumn[];
    cursor: string | null;
    part: number;
    rowsBefore: number;
    bytesBefore: number;
    key: string;
  }
): Promise<ExportPartResult> {
  const chunks: string[] = [];
  let bytes = 0;
  const add = (chunk: string) => {
    chunks.push(chunk);
    bytes += encoder.encode(chunk).byteLength;
  };
  if (args.part === 0) add(encodeExportHeader(args.columns));

  const read = await readListPages({
    handlers: deps.handlers,
    listKey: args.listKey,
    context: args.context,
    search: args.search,
    cursor: args.cursor,
    rowsBefore: args.rowsBefore,
    maxRows: MAX_EXPORT_ROWS,
    forExport: true,
    onPage: (rows) => {
      const lines = encodeExportRows(rows, args.columns);
      if (lines) add(`\r\n${lines}`);
      return args.bytesBefore + bytes < MAX_EXPORT_BYTES;
    }
  });

  await deps.storage.upload(args.key, chunks.join(""), CSV_CONTENT_TYPE);
  return {
    rows: read.rows,
    bytes,
    nextCursor: read.nextCursor,
    truncated: read.truncated
  };
}

/**
 * A stream of the parts in order, one part in memory at a time: each is
 * downloaded only when the upload asks for more.
 */
export function concatParts(
  storage: Pick<TableJobStorage, "download">,
  keys: string[]
): ReadableStream<Uint8Array> {
  let next = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const key = keys[next++];
      if (key === undefined) {
        controller.close();
        return;
      }
      try {
        controller.enqueue(await storage.download(key));
      } catch (error) {
        controller.error(error);
      }
    }
  });
}

/** Streams the parts into the export file. The parts stay, so a retried
 *  compose writes the same file again; `removeExportParts` deletes them in
 *  the step after it. */
export async function composeExport(
  deps: Pick<ExportDeps, "storage">,
  args: { partKeys: string[]; key: string }
): Promise<void> {
  await deps.storage.upload(
    args.key,
    concatParts(deps.storage, args.partKeys),
    CSV_CONTENT_TYPE
  );
}

/** Deletes the parts of a composed export. A part that cannot be deleted is
 *  logged; the nightly cleanup removes it. */
export async function removeExportParts(
  deps: Pick<ExportDeps, "storage">,
  args: { partKeys: string[]; key: string }
): Promise<{ partsRemoved: boolean }> {
  try {
    await deps.storage.remove(args.partKeys);
    return { partsRemoved: true };
  } catch (error) {
    log.error("Failed to delete the parts of an export", {
      key: args.key,
      error
    });
    return { partsRemoved: false };
  }
}
