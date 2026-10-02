// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { KyselyTx } from "@carbon/database/client";
import { describe, expect, it, vi } from "vitest";

/**
 * The ONE stub, and it is the real external boundary: `withTriggersDisabled`
 * opens a Postgres transaction and issues `SET LOCAL app.sync_in_progress`. The
 * behaviour under test is WHEN the mapping write happens relative to the next
 * platform call, not what a Kysely transaction does — so the wrapper hands the
 * callback a sentinel and everything else below runs real.
 */
const TX = { sentinel: true } as unknown as KyselyTx;

vi.mock("../accounting/core/utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../accounting/core/utils")>();
  return {
    ...actual,
    withTriggersDisabled: async <T>(
      _db: unknown,
      operation: (tx: KyselyTx) => Promise<T>
    ) => operation(TX)
  };
});

import type { EntityConfig, SyncContext } from "../accounting/core/types";
import { SpendPushOnlyEntitySyncer } from "./push-only-syncer";

type TestLocal = { id: string; updatedAt: string };
type TestRemote = { name: string };

/**
 * A minimal spend syncer. It records an interleaved event log so the ORDER of
 * platform call vs mapping write is observable — the whole point of the fix is
 * that a mapping lands before the next document is pushed.
 */
class TestSpendSyncer extends SpendPushOnlyEntitySyncer<
  TestLocal,
  TestRemote,
  never
> {
  readonly events: string[] = [];
  readonly linked: Array<{ localId: string; remoteId: string; tx: KyselyTx }> =
    [];
  fetchLocalBatchCalls = 0;

  constructor(
    context: SyncContext,
    private readonly failOn: ReadonlySet<string> = new Set(),
    private readonly skipOn: ReadonlyMap<string, string> = new Map(),
    private readonly missing: ReadonlySet<string> = new Set()
  ) {
    super(context);
  }

  protected get pushOnlyEntityLabel(): string {
    return "Test documents";
  }

  protected get spendPlatformLabel(): string {
    return "TestPlatform";
  }

  protected async fetchLocal(id: string): Promise<TestLocal | null> {
    return (await this.fetchLocalBatch([id])).get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, TestLocal>> {
    this.fetchLocalBatchCalls += 1;
    return new Map(
      ids
        .filter((id) => !this.missing.has(id))
        .map((id) => [id, { id, updatedAt: "2026-09-28T00:00:00.000Z" }])
    );
  }

  protected async shouldSync(context: {
    entityId: string;
  }): Promise<boolean | string> {
    return this.skipOn.get(context.entityId) ?? true;
  }

  protected async mapToRemote(local: TestLocal): Promise<TestRemote> {
    return { name: local.id };
  }

  protected async upsertRemote(
    _data: TestRemote,
    localId: string
  ): Promise<string> {
    this.events.push(`push:${localId}`);
    if (this.failOn.has(localId)) throw new Error(`boom ${localId}`);
    return `remote-${localId}`;
  }

  protected async linkEntities(
    tx: KyselyTx,
    localId: string,
    remoteId: string
  ): Promise<void> {
    this.events.push(`link:${localId}`);
    this.linked.push({ localId, remoteId, tx });
  }
}

function makeSyncer(
  args: {
    failOn?: ReadonlySet<string>;
    skipOn?: ReadonlyMap<string, string>;
    missing?: ReadonlySet<string>;
    config?: Partial<EntityConfig>;
  } = {}
): TestSpendSyncer {
  return new TestSpendSyncer(
    {
      database: {} as never,
      companyId: "company-1",
      provider: { id: "ramp" } as never,
      entityType: "purchaseOrder",
      config: {
        enabled: true,
        direction: "push-to-accounting",
        owner: "carbon",
        ...args.config
      } as EntityConfig
    },
    args.failOn,
    args.skipOn,
    args.missing
  );
}

/**
 * The bug these pin: the base batch push collected every remote id first and
 * wrote all the mappings afterwards in ONE `linkBatch`. The drain groups every
 * claimed operation of one `(entityType, direction)` into a single call, so a
 * second document failing threw out of the loop before the first one's remote id
 * had been persisted — the base `catch` then marked the WHOLE batch Failed and
 * left the document that really did reach the platform unmapped. For a Ramp
 * draft bill (create-once, `409 DEVELOPER_7153` on a second create with the same
 * `remote_id`) that is permanent: the retry has no mapping to short-circuit on.
 */
describe("SpendPushOnlyEntitySyncer.pushBatchToAccounting", () => {
  it("persists each mapping before the next document is pushed", async () => {
    const syncer = makeSyncer({ failOn: new Set(["b"]) });

    await syncer.pushBatchToAccounting(["a", "b", "c"]);

    expect(syncer.events).toEqual([
      "push:a",
      "link:a",
      "push:b",
      "push:c",
      "link:c"
    ]);
    expect(syncer.linked.map((entry) => entry.localId)).toEqual(["a", "c"]);
    expect(syncer.linked[0]?.remoteId).toBe("remote-a");
    // Written through the trigger-disabled transaction, not the bare database.
    expect(syncer.linked[0]?.tx).toBe(TX);
  });

  it("does not report an already-pushed document as failed", async () => {
    const syncer = makeSyncer({ failOn: new Set(["b"]) });

    const result = await syncer.pushBatchToAccounting(["a", "b", "c"]);

    expect(result.results).toEqual([
      {
        status: "success",
        action: "updated",
        localId: "a",
        remoteId: "remote-a"
      },
      { status: "error", action: "none", localId: "b", error: "boom b" },
      {
        status: "success",
        action: "updated",
        localId: "c",
        remoteId: "remote-c"
      }
    ]);
    expect(result.successCount).toBe(2);
    expect(result.errorCount).toBe(1);
    expect(result.skippedCount).toBe(0);
  });

  it("loads the page once, so a per-page prefetch is not repeated per document", async () => {
    // Ramp's purchase-order syncer preloads the mapping snapshot plus one
    // paginated vendor list in `fetchLocalBatch`. Settling per item must not turn
    // that back into a pair of reads per document.
    const syncer = makeSyncer();

    await syncer.pushBatchToAccounting(["a", "b", "c"]);

    expect(syncer.fetchLocalBatchCalls).toBe(1);
  });

  it("keeps a skip reason on its own document", async () => {
    const syncer = makeSyncer({
      skipOn: new Map([["b", "already handed off to Ramp"]])
    });

    const result = await syncer.pushBatchToAccounting(["a", "b"]);

    expect(result.results).toContainEqual({
      status: "success",
      action: "updated",
      localId: "a",
      remoteId: "remote-a"
    });
    expect(result.results).toContainEqual({
      status: "skipped",
      action: "none",
      localId: "b",
      error: "already handed off to Ramp"
    });
    expect(syncer.events).toEqual(["push:a", "link:a"]);
  });

  it("errors only the document it could not load", async () => {
    const syncer = makeSyncer({ missing: new Set(["b"]) });

    const result = await syncer.pushBatchToAccounting(["a", "b"]);

    // Order-independent on purpose: which slot a not-found lands in is not the
    // contract, "it does not poison its neighbours" is.
    expect(result.results).toContainEqual({
      status: "success",
      action: "updated",
      localId: "a",
      remoteId: "remote-a"
    });
    expect(result.results).toContainEqual({
      status: "error",
      action: "none",
      localId: "b",
      error: "Entity b not found in Carbon"
    });
  });

  it("skips the whole batch when the entity is disabled, pushing nothing", async () => {
    const syncer = makeSyncer({ config: { enabled: false } });

    const result = await syncer.pushBatchToAccounting(["a", "b"]);

    expect(result.skippedCount).toBe(2);
    expect(syncer.fetchLocalBatchCalls).toBe(0);
    expect(syncer.events).toEqual([]);
  });
});
