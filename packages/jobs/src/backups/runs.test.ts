// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { NonRetriableError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobDatabase } from "../db";
import {
  assertNoPendingChange,
  failRun,
  failStuckRun,
  keepRun,
  progressWriter,
  RESTORE_INTEGRATION,
  type RestoreRunMeta,
  resumeRun,
  revertRun,
  runMarker,
  TEMPLATE_INTEGRATION,
  type TemplateRunMeta,
  takeSnapshot
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
 * storage bucket holding `files` (full paths).
 */
function fakeClient(
  opts: {
    failWrites?: boolean;
    failStorageRemove?: boolean;
    companies?: Array<{ id: string; companyGroupId: string }>;
    files?: string[];
  } = {}
) {
  const rows: Row[] = [];
  const files = new Set(opts.files ?? []);
  const list = async (prefix: string, o?: { offset?: number }) => {
    if ((o?.offset ?? 0) > 0) return { data: [], error: null };
    const children = new Map<string, boolean>();
    for (const f of files) {
      if (!f.startsWith(`${prefix}/`)) continue;
      const [head, ...rest] = f.slice(prefix.length + 1).split("/");
      children.set(head!, rest.length === 0);
    }
    const data = [...children].map(([name, isFile]) => ({
      name,
      id: isFile ? name : null,
      metadata: { size: 1 }
    }));
    return { data, error: null };
  };
  const remove = async (paths: string[]) => {
    if (opts.failStorageRemove) {
      return { data: null, error: { message: "storage down" } };
    }
    for (const p of paths) files.delete(p);
    return { data: [], error: null };
  };
  let nextId = 0;
  const matches = (filters: Array<(r: Row) => boolean>) => (r: Row) =>
    filters.every((f) => f(r));
  const companyQuery = () => {
    const filters: [string, unknown][] = [];
    const hit = () =>
      (opts.companies ?? []).filter((c) =>
        filters.every(([k, v]) => c[k as keyof typeof c] === v)
      );
    const q = {
      eq(k: string, v: unknown) {
        filters.push([k, v]);
        return q;
      },
      single: async () => ({ data: hit()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: hit(), count: hit().length, error: null })
    };
    return q;
  };
  const query = (op: "select" | "update" | "delete", patch?: object) => {
    const filters: Array<(r: Row) => boolean> = [];
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
        filters.push((r) => r[k as keyof Row] === v);
        return q;
      },
      in(k: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[k as keyof Row]));
        return q;
      },
      maybeSingle: async () => {
        const hit = rows.filter(matches(filters));
        return { data: hit[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => void) => resolve(run())
    };
    return q;
  };
  const client = {
    from: (table: string) => ({
      select: () => (table === "company" ? companyQuery() : query("select")),
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
    storage: { from: () => ({ list, remove }) }
  };
  return { client: client as never, rows, files };
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
    await m.write({ status: "running", filePath: "x" });
    await m.write({ snapshotPath: "_pre-restore-r1" });
    expect(await m.read()).toMatchObject({
      status: "running",
      filePath: "x",
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
    const write = vi.fn(async (_patch: object) => undefined);
    const report = progressWriter({ write });
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
      write: vi.fn(async () => {
        throw new Error("down");
      })
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

  it("retires the marker even when its snapshot can't be deleted", async () => {
    // Snapshot first, marker second left a marker naming a half-deleted
    // snapshot, which a revert would then load.
    const { client, files } = fakeClient({
      files: ["exports/_pre-restore-r1/manifest.json"],
      failStorageRemove: true
    });
    await restore(client, "r1").write({
      status: "ready",
      snapshotPath: "_pre-restore-r1"
    });
    expect(await keepRun(client, restore(client, "r1"), "co")).toBe(true);
    expect(await restore(client, "r1").read()).toBeNull();
    expect(files.size).toBe(1);
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
  it("never loads the snapshot of a failed run whose data didn't land", async () => {
    // That snapshot is older than the company's data: loading it would wipe
    // whatever the user did since. The fake database throws if touched.
    const { client } = fakeClient();
    await restore(client, "r1").write({
      status: "failed",
      error: "boom",
      snapshotPath: "_pre-restore-r1"
    });
    const result = await revertRun(
      client,
      {} as JobDatabase,
      restore(client, "r1"),
      "co"
    );
    expect(result).toEqual({ reverted: false });
    expect(await restore(client, "r1").read()).toMatchObject({
      status: "failed",
      error: "boom",
      snapshotPath: "_pre-restore-r1"
    });
  });

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

  it("refuses to revert group data once another company shares the group", async () => {
    const { client } = fakeClient({
      companies: [
        { id: "co", companyGroupId: "g" },
        { id: "co2", companyGroupId: "g" }
      ]
    });
    await restore(client, "r1").write({
      status: "ready",
      snapshotPath: "_pre-restore-r1",
      includeGroup: true
    });
    const result = await revertRun(
      client,
      {} as JobDatabase,
      restore(client, "r1"),
      "co"
    );
    expect(result).toEqual({ reverted: false });
    const meta = await restore(client, "r1").read();
    expect(meta?.status).toBe("failed");
    expect(meta?.error).toContain("Another company joined");
    expect(meta?.snapshotPath).toBe("_pre-restore-r1");
  });
});

describe("failStuckRun", () => {
  it("marks a run that died mid-flight failed", async () => {
    const { client } = fakeClient();
    await restore(client, "r1").write({ status: "running" });
    await failStuckRun(
      restore(client, "r1"),
      new Error("timed out"),
      "running"
    );
    expect(await restore(client, "r1").read()).toMatchObject({
      status: "failed",
      error: "timed out"
    });
  });

  it("leaves a settled run, and never creates a marker", async () => {
    const { client } = fakeClient();
    await restore(client, "r1").write({ status: "ready" });
    await failStuckRun(restore(client, "r1"), new Error("late"), "running");
    await failStuckRun(
      restore(client, "r2"),
      new Error("never ran"),
      "running"
    );
    expect((await restore(client, "r1").read())?.status).toBe("ready");
    expect(await restore(client, "r2").read()).toBeNull();
  });

  it("leaves the user's revert alone when the apply's handler fires", async () => {
    const { client } = fakeClient();
    await restore(client, "r1").write({ status: "reverting", applied: true });
    await failStuckRun(restore(client, "r1"), new Error("apply"), "running");
    expect((await restore(client, "r1").read())?.status).toBe("reverting");
    await failStuckRun(restore(client, "r1"), new Error("oom"), "reverting");
    expect((await restore(client, "r1").read())?.error).toBe(
      "Revert failed: oom"
    );
  });

  it("leaves a later run on the same marker alone", async () => {
    const { client } = fakeClient();
    await template(client, "t2").write({ status: "running" });
    await failStuckRun(
      template(client, "t1"),
      new Error("t1 died"),
      "running",
      (meta) => meta.templateRunId === "t1"
    );
    expect(await template(client, "t2").read()).toMatchObject({
      templateRunId: "t2",
      status: "running"
    });
  });
});

describe("resumeRun", () => {
  it("starts a run that changed nothing yet", () => {
    expect(resumeRun({ status: "running" })).toBe("start");
    expect(resumeRun({ status: "failed" })).toBe("start");
  });

  it("skips a run whose marker the user removed during a retry backoff", () => {
    expect(resumeRun(null)).toBe("skip");
  });

  it("finishes, never reloads, a retry whose data already committed", () => {
    expect(resumeRun({ status: "failed", applied: true })).toBe("finish");
    expect(resumeRun({ status: "running", applied: true })).toBe("finish");
  });

  it("skips a run that is settled, being reverted, or was reverted", () => {
    expect(resumeRun({ status: "ready", applied: true })).toBe("skip");
    expect(resumeRun({ status: "reverting", applied: true })).toBe("skip");
    expect(resumeRun({ status: "failed", applied: true, reverted: true })).toBe(
      "skip"
    );
  });
});

describe("takeSnapshot", () => {
  it("deletes a snapshot that failed partway, and records nothing", async () => {
    // The fake has no company group, so the dump throws: the folder was never
    // recorded, and nothing else would ever delete it.
    const { client, files } = fakeClient({
      files: [
        "exports/_pre-restore-r1/tables/item.ndjson.gz",
        "exports/kept/manifest.json"
      ]
    });
    await restore(client, "r1").write({ status: "running" });
    await expect(
      takeSnapshot(client, {} as JobDatabase, restore(client, "r1"), {
        run: "restore",
        runId: "r1",
        companyId: "co",
        userId: "u",
        record: {},
        onProgress: async () => undefined
      })
    ).rejects.toThrow("companyGroup");
    expect([...files]).toEqual(["exports/kept/manifest.json"]);
    expect((await restore(client, "r1").read())?.snapshotPath).toBeUndefined();
  });
});

describe("assertNoPendingChange", () => {
  it("refuses a restore while a demo data change waits on keep or revert", async () => {
    const { client } = fakeClient();
    await template(client, "t1").write({ status: "ready" });
    await expect(
      assertNoPendingChange(client, "co", { restoreRunId: "r1" })
    ).rejects.toThrow("demo data change");
  });

  it("refuses demo data while a failed restore's data is still loaded", async () => {
    const { client } = fakeClient();
    await restore(client, "r1").write({ status: "failed", applied: true });
    await expect(
      assertNoPendingChange(client, "co", { templateRunId: "t1" })
    ).rejects.toThrow("restore");
  });

  it("lets a run retry itself past a failed run that changed nothing", async () => {
    const { client } = fakeClient();
    await restore(client, "r0").write({ status: "failed" });
    await restore(client, "r1").write({ status: "running" });
    await expect(
      assertNoPendingChange(client, "co", { restoreRunId: "r1" })
    ).resolves.toBeUndefined();
  });
});
