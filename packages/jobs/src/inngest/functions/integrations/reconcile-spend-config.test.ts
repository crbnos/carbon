// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { buildIntegrationTopology } from "@carbon/ee/sync";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncOperationRequest } from "./accounting-sync-operations";
import { reconcileEntities } from "./reconcile-executor";

const { requests } = vi.hoisted(() => ({
  requests: [] as SyncOperationRequest[]
}));

vi.mock("./accounting-sync-operations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accounting-sync-operations")>()),
  enqueueSyncOperations: async (
    _client: unknown,
    args: { requests: SyncOperationRequest[] }
  ) => {
    requests.push(...args.requests);
    return args.requests.map(() => ({ outcome: "enqueued" }));
  },
  insertTerminalSyncOperations: async () => []
}));

beforeEach(() => {
  requests.length = 0;
});

/** Nothing delegated: a plain Ramp install holding the accounting seat. */
const CARBON_TOPOLOGY = buildIntegrationTopology([], []);

/** A posted, unmapped purchase invoice — the shape the sweep and events hand in. */
function fixtures() {
  const client = {
    from() {
      const query = {
        select: () => query,
        eq: () => query,
        not: () => query,
        in: async () => ({
          error: null,
          data: [
            { id: "pi-1", status: "Open", updatedAt: "2026-09-28T00:00:00Z" }
          ]
        })
      };
      return query;
    }
  };
  const database = {
    selectFrom: () => {
      const query = {
        select: () => query,
        distinct: () => query,
        innerJoin: () => query,
        where: () => query,
        execute: async () => []
      };
      return query;
    }
  };
  return { client, database };
}

const entityConfig = (enabled: boolean) => ({
  enabled,
  direction: "push-to-accounting" as const,
  owner: "carbon" as const
});

async function reconcileBill(
  providerId: string,
  provider?: { getSyncConfig: (entity: string) => unknown }
) {
  const { client, database } = fixtures();
  return await reconcileEntities({
    topology: CARBON_TOPOLOGY,
    client: client as never,
    database: database as never,
    companyId: "company-1",
    providerId,
    // A spend platform stores its toggles under `sync`, NEVER under
    // `syncConfig` — which is the only key `resolveSyncConfig` reads.
    integrationMetadata: {
      syncMode: "provider",
      sync: { pushPurchaseOrders: false, pushInvoices: false }
    },
    ...(provider ? { provider: provider as never } : {}),
    createdBy: "system",
    scope: "spend-config",
    refs: [{ entityType: "bill", entityId: "pi-1" }]
  });
}

describe("reconcileEntities with a spend provider", () => {
  it("does not enqueue a bill the platform's config has disabled", async () => {
    // The bug: `resolveSyncConfig` reads `metadata.syncConfig`, which a spend
    // platform never writes, so it returned DEFAULT_SYNC_CONFIG — where `bill`
    // is enabled. Reconciliation enqueued a push the drain then skipped on
    // `config.enabled`, filling the ledger with "Sync disabled in config" rows.
    const summary = await reconcileBill("ramp", {
      getSyncConfig: () => entityConfig(false)
    });

    expect(requests).toEqual([]);
    expect(summary.enqueued).toBe(0);
    expect(summary.nothing).toBe(1);
  });

  it("still enqueues when the platform's config has it enabled", async () => {
    const summary = await reconcileBill("ramp", {
      getSyncConfig: () => entityConfig(true)
    });

    expect(requests).toEqual([
      {
        entityType: "bill",
        entityId: "pi-1",
        direction: "push-to-accounting"
      }
    ]);
    expect(summary.enqueued).toBe(1);
  });

  it("leaves an accounting provider on its metadata-resolved config", async () => {
    // Scoped to spend on purpose: `getProviderIntegration` FORCES entities for
    // an accounting provider (Rillet's `payment`, say) that the generic default
    // has off, so substituting its config here would change behaviour well
    // outside this gap. A provider passed for `rillet` must be ignored.
    const summary = await reconcileBill("rillet", {
      getSyncConfig: () => entityConfig(false)
    });

    expect(summary.enqueued).toBe(1);
  });

  it("is unchanged when no provider is supplied", async () => {
    const summary = await reconcileBill("ramp");

    expect(summary.enqueued).toBe(1);
  });
});
