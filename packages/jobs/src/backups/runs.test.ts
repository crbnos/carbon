// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { NonRetriableError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobDatabase } from "../db";
import {
  failRun,
  keepRun,
  progressWriter,
  RESTORE_INTEGRATION,
  type RestoreRunMeta,
  revertRun,
  runMarker,
  TEMPLATE_INTEGRATION,
  type TemplateRunMeta
} from "./runs";
import { ExportScopeViolationError } from "./scope";

type Row = {
  id: string;
  integration: string;
  entityType: string;
  entityId: string;
  externalId: string;
  companyId: string;
  createdBy: string;
  metadata: Record<string, unknown>;
};

/**
 * `externalIntegrationMapping` in memory, with the partial unique index the
 * table really has on (integration, externalId, entityType, companyId), plus a
 * storage bucket that is always empty.
 */
function fakeClient(opts: { failWrites?: boolean } = {}) {
  const rows: Row[] = [];
  let nextId = 0;
  const matches = (filters: [string, unknown][]) => (r: Row) =>
    filters.every(([k, v]) => r[k as keyof Row] === v);
  const query = (op: "select" | "update" | "delete", patch?: object) => {
    const filters: [string, unknown][] = [];
    const run = () => {
      if (opts.failWrites && op !== "select") {
        return { data: null, error: { message: "write refused" } };
      }
      const hit = rows.filter(matches(filters));
      if (op === "update") for (const r of hit) Object.assign(r, patch);
      if (op === "delete") {
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
      }
      return { data: hit, error: null };
    };
    const q = {
      eq(k: string, v: unknown) {
        filters.push([k, v]);
        return q;
      },
      maybeSingle: async () => {
        const hit = rows.filter(matches(filters));
        return { data: hit[0] ?? null, error: null };
      },
      // biome-ignore lint/suspicious/noThenProperty: a thenable like the client's builder
      then: (resolve: (v: unknown) => void) => resolve(run())
    };
    return q;
  };
  const client = {
    from: () => ({
      select: () => query("select"),
      update: (patch: object) => query("update", patch),
      delete: () => query("delete"),
      insert: async (row: Omit<Row, "id">) => {
        if (opts.failWrites) return { error: { message: "write refused" } };
        const clash = rows.some(
          (r) =>
            r.integration === row.integration &&
            r.externalId === row.externalId &&
            r.entityType === row.entityType &&
            r.companyId === row.companyId
        );
        if (clash) return { error: { message: "duplicate key value" } };
        rows.push({ ...row, id: String(nextId++) });
        return { error: null };
      }
    }),
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ data: [], error: null })
      })
    }
  };
  return { client: client as never, rows };
}

const restore = (client: never, restoreRunId: string) =>
  runMarker<RestoreRunMeta>(client, {
    integration: RESTORE_INTEGRATION,
    entityType: "restore",
    entityId: restoreRunId,
    companyId: "co",
    userId: "u",
    identity: { restoreRunId }
  });

const template = (client: never, templateRunId: string) =>
  runMarker<TemplateRunMeta>(client, {
    integration: TEMPLATE_INTEGRATION,
    entityType: "template",
    entityId: "co",
    companyId: "co",
    userId: "u",
    identity: { templateRunId }
  });

describe("runMarker", () => {
  it("keeps two restore runs side by side", async () => {
    // A failed restore and the next one both start without a snapshot; the
    // unique index must not see them as the same row.
    const { client, rows } = fakeClient();
    await restore(client, "r1").write({ status: "failed" });
    await restore(client, "r2").write({ status: "running" });
    expect(rows).toHaveLength(2);
    expect(await restore(client, "r1").read()).toMatchObject({
      restoreRunId: "r1",
      status: "failed"
    });
  });

  it("merges a write into what the row already holds", async () => {
    const { client } = fakeClient();
    const m = restore(client, "r1");
    await m.write({ status: "running", label: "x" });
    await m.write({ snapshotPath: "_pre-restore-r1" });
    expect(await m.read()).toMatchObject({
      status: "running",
      label: "x",
      snapshotPath: "_pre-restore-r1"
    });
  });

  it("stamps this run's id over an earlier run's on the shared row", async () => {
    const { client } = fakeClient();
    await template(client, "old").write({ status: "failed" });
    await template(client, "new").write({ status: "running" });
    expect((await template(client, "new").read())?.templateRunId).toBe("new");
  });

  it("clears only its own run", async () => {
    const { client, rows } = fakeClient();
    await restore(client, "r1").write({ status: "ready" });
    await restore(client, "r2").write({ status: "ready" });
    await restore(client, "r1").clear();
    expect(rows.map((r) => r.entityId)).toEqual(["r2"]);
  });

  it("throws when a write is refused", async () => {
    const { client } = fakeClient({ failWrites: true });
    await expect(restore(client, "r1").write({})).rejects.toThrow(
      "write refused"
    );
  });
});

describe("progressWriter", () => {
  afterEach(() => vi.useRealTimers());

  it("drops same-phase ticks in the window but never a phase change or the last tick", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (_patch: object) => {});
    const report = progressWriter({ read: vi.fn(), write, clear: vi.fn() });
    await report({ phase: "load", done: 1, total: 10 });
    await report({ phase: "load", done: 2, total: 10 });
    await report({ phase: "wipe", done: 1, total: 10 });
    await report({ phase: "wipe", done: 10, total: 10 });
    vi.advanceTimersByTime(300);
    await report({ phase: "wipe", done: 3, total: 10 });
    expect(write.mock.calls.map((c) => c[0])).toEqual([
      { progress: { phase: "load", done: 1, total: 10 } },
      { progress: { phase: "wipe", done: 1, total: 10 } },
      { progress: { phase: "wipe", done: 10, total: 10 } },
      { progress: { phase: "wipe", done: 3, total: 10 } }
    ]);
  });

  it("never fails the run over a lost progress write", async () => {
    const report = progressWriter({
      read: vi.fn(),
      write: vi.fn(async () => {
        throw new Error("down");
      }),
      clear: vi.fn()
    });
    await expect(
      report({ phase: "load", done: 1, total: 2 })
    ).resolves.toBeUndefined();
  });
});

describe("failRun", () => {
  it("records a scope violation and stops retries", async () => {
    const { client } = fakeClient();
    const m = restore(client, "r1");
    const violations = [{ table: "a", column: "b", refTable: "c", rows: 2 }];
    const err = new ExportScopeViolationError("co", violations, [
      { table: "a", rows: 1 }
    ]);
    const thrown = await failRun(m, err);
    expect(thrown).toBeInstanceOf(NonRetriableError);
    expect(await m.read()).toMatchObject({
      status: "failed",
      reason: "scope-violations",
      violations,
      violationRowsByTable: [{ table: "a", rows: 1 }]
    });
  });

  it("returns any other error as it was, so it is retried", async () => {
    const { client } = fakeClient();
    const err = new Error("boom");
    expect(await failRun(restore(client, "r1"), err, "Revert failed: ")).toBe(
      err
    );
    expect((await restore(client, "r1").read())?.error).toBe(
      "Revert failed: boom"
    );
  });

  it("still returns the error when the marker can't be written", async () => {
    const { client } = fakeClient({ failWrites: true });
    const err = new Error("boom");
    expect(await failRun(restore(client, "r1"), err)).toBe(err);
  });
});

describe("keepRun", () => {
  it("refuses a run still in flight", async () => {
    const { client } = fakeClient();
    await restore(client, "r1").write({ status: "running" });
    await expect(keepRun(client, restore(client, "r1"), "co")).rejects.toThrow(
      "running"
    );
    expect(await restore(client, "r1").read()).not.toBeNull();
  });

  it("clears a ready run", async () => {
    const { client } = fakeClient();
    await restore(client, "r1").write({
      status: "ready",
      snapshotPath: "_pre-restore-r1"
    });
    expect(await keepRun(client, restore(client, "r1"), "co")).toBe(true);
    expect(await restore(client, "r1").read()).toBeNull();
  });
});

describe("revertRun", () => {
  it("marks a run with no snapshot failed instead of leaving a dead Revert", async () => {
    const { client } = fakeClient();
    await restore(client, "r1").write({ status: "ready" });
    const result = await revertRun(
      client,
      {} as JobDatabase,
      restore(client, "r1"),
      "co"
    );
    expect(result).toEqual({ reverted: false });
    expect(await restore(client, "r1").read()).toMatchObject({
      status: "failed"
    });
  });
});
