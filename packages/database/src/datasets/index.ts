/**
 * The dataset engine: applies one industry story's worth of data to a company.
 *
 * Two callers share this — the dev CLI (`src/seed-dev.ts`, which additionally
 * bootstraps and wipes) and the `company-template` job that provisions an
 * onboarding demo company. Insertion logic lives in `tiers/`, the data in
 * `data/<key>/`, so a new template costs data only.
 */

import { today } from "@internationalized/date";
import type { PoolClient } from "pg";
import { motor } from "./data/motor/index.ts";
import { precision } from "./data/precision/index.ts";
import { robotics } from "./data/robotics/index.ts";
import { satellite } from "./data/satellite/index.ts";
import { ensureSequences } from "./sql.ts";
import { selectTiers } from "./tiers/index.ts";
import {
  buildCtx,
  type Ctx,
  type Dataset,
  type DatasetKey,
  resolveCompanyTimeZone
} from "./types.ts";

export type { Ctx, Dataset, DatasetKey };
export { resolveCompanyTimeZone };

export const DATASETS: Record<DatasetKey, Dataset> = {
  satellite,
  robotics,
  precision,
  motor
};

export function getDataset(key: string): Dataset | null {
  // hasOwn, not a bare index — "toString" would otherwise resolve up the
  // prototype chain and slip past every caller's `if (!dataset)` guard.
  if (!Object.hasOwn(DATASETS, key)) return null;
  return DATASETS[key as DatasetKey];
}

export function datasetKeys(): DatasetKey[] {
  return Object.keys(DATASETS) as DatasetKey[];
}

export function datasetForIndustry(industryId: string | null): Dataset | null {
  if (!industryId) return null;
  return (
    Object.values(DATASETS).find((d) => d.industryId === industryId) ?? null
  );
}

export async function applyDataset(
  client: PoolClient,
  opts: {
    companyId: string;
    userId: string;
    dataset: Dataset;
    timeZone: string;
    tiers?: number[] | null;
    log?: (message: string) => void;
    /** Dev-only work that must share the tiers' transaction (the wipe). */
    beforeTiers?: (ctx: Ctx) => Promise<void>;
  }
): Promise<void> {
  const {
    companyId,
    userId,
    dataset,
    timeZone,
    tiers = null,
    log = () => {},
    beforeTiers
  } = opts;

  const anchor = today(timeZone);
  const ctx = await buildCtx(client, companyId, userId, dataset, anchor, (m) =>
    log(`  ${m}`)
  );
  const selected = selectTiers(tiers ?? null);

  await client.query("BEGIN");
  try {
    // Suppresses dispatch_event_batch (pgmq + pg_net). Sync interceptors
    // still run, so the satellite rows we depend on are still created.
    await client.query(`SET LOCAL "app.sync_in_progress" = 'true'`);

    // Must run before resetSequences, and before any nextSequence() call.
    await ensureSequences(client, companyId);

    if (beforeTiers) await beforeTiers(ctx);

    for (const tier of selected) {
      log(`Tier ${tier.n}: ${tier.name}`);
      await tier.run(ctx);
    }

    await client.query("COMMIT");
  } catch (err) {
    // A dropped connection is the likeliest cause of a mid-seed failure, and
    // the ROLLBACK rejects too — swallow that so the original error survives.
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  }
}
