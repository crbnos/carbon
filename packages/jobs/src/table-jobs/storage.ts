// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { TEMP_STAGING_BUCKET } from "@carbon/files";

/**
 * Where the table jobs keep their files: the `temp-staging` bucket, under the
 * company's prefix. The nightly cleanup (`prune-staged-raw-models`) deletes an
 * object there after 7 days, so a file a job could not remove still goes.
 */

/** The finished export. Per user: the ERP's export download route
 *  (`api+/table.export.$exportId.ts`) serves it to this user only. */
export function tableExportStorageKey(
  companyId: string,
  userId: string,
  exportId: string
): string {
  return `${companyId}/exports/${userId}/${exportId}.csv`;
}

/** One part of an export, written by one step. The last step joins them. */
export function tableExportPartKey(
  companyId: string,
  userId: string,
  exportId: string,
  part: number
): string {
  return `${companyId}/exports/${userId}/${exportId}.parts/${part}.csv`;
}

/** The ids one collect step of a bulk action read, as a JSON array. */
export function tableBulkIdsKey(
  companyId: string,
  bulkActionId: string,
  file: number
): string {
  return `${companyId}/bulk-actions/${bulkActionId}/${file}.json`;
}

/** The storage the table jobs use. Every call throws on failure. */
export interface TableJobStorage {
  upload(
    key: string,
    body: string | ReadableStream<Uint8Array>,
    contentType: string
  ): Promise<void>;
  download(key: string): Promise<Uint8Array>;
  remove(keys: string[]): Promise<void>;
}

/** `temp-staging`, read and written with the service role. */
export function tempStagingStorage(): TableJobStorage {
  const bucket = () => getCarbonServiceRole().storage.from(TEMP_STAGING_BUCKET);
  return {
    async upload(key, body, contentType) {
      // storage-js sends a ReadableStream as the request body with
      // `duplex: "half"`, so a stream is never held in memory whole.
      const result = await bucket().upload(key, body, {
        contentType,
        upsert: true
      });
      if (result.error) throw result.error;
    },
    async download(key) {
      const result = await bucket().download(key);
      if (result.error) throw result.error;
      return new Uint8Array(await result.data.arrayBuffer());
    },
    async remove(keys) {
      if (keys.length === 0) return;
      const result = await bucket().remove(keys);
      if (result.error) throw result.error;
    }
  };
}
