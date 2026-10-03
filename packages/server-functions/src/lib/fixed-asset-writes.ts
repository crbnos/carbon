// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { updateRows } from "@carbon/database/rows";

type FixedAssetUpdate = Database["public"]["Tables"]["fixedAsset"]["Update"];
type Write = (trx: Kysely<KyselyDatabase>) => Promise<unknown>;

/** Fixed-asset writes decided while the journal is built, applied inside the
 *  posting transaction so a failed post leaves the asset register untouched. */
export class FixedAssetWrites {
  private patches = new Map<string, FixedAssetUpdate>();
  private writes: Write[] = [];

  /** Later lines of one document see what earlier lines staged. */
  overlay<T extends object>(assetId: string, row: T): T {
    return Object.assign(row, this.patches.get(assetId));
  }

  patch(assetId: string, set: FixedAssetUpdate): void {
    this.patches.set(assetId, { ...this.patches.get(assetId), ...set });
  }

  defer(write: Write): void {
    this.writes.push(write);
  }

  async apply(trx: Kysely<KyselyDatabase>, companyId: string): Promise<void> {
    for (const [id, set] of this.patches) {
      await updateRows(trx, "fixedAsset", set, { id, companyId });
    }
    for (const write of this.writes) await write(trx);
  }
}
