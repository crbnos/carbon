import { afterEach, describe, expect, it, vi } from "vitest";
import { readOnshapeImportStatus, STALE_AFTER_MS } from "./onshapeImportStatus";

// Absolute instants only — these are epoch comparisons against a marker written
// by a job, never a calendar date rendered to anyone.
const NOW = Date.parse("2026-08-25T12:00:00.000Z");

function at(offsetMs: number) {
  return new Date(NOW + offsetMs).toISOString();
}

afterEach(() => {
  vi.useRealTimers();
});

function freeze() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
}

describe("readOnshapeImportStatus", () => {
  it("is idle with no marker at all", () => {
    freeze();
    expect(readOnshapeImportStatus(null).running).toBe(false);
    expect(readOnshapeImportStatus({}).running).toBe(false);
  });

  it("is idle for a marker with no start", () => {
    // A finish with no start describes an import that never began. Reading it
    // as finished would let a blocking UI navigate on a part nothing built.
    freeze();
    const status = readOnshapeImportStatus({ finishedAt: at(-1000) });
    expect(status.running).toBe(false);
    expect(status.justFinished).toBe(false);
  });

  it("is idle for an unparseable start rather than running forever", () => {
    freeze();
    expect(readOnshapeImportStatus({ startedAt: "not a date" }).running).toBe(
      false
    );
  });

  it("reports the stage and its progress while running", () => {
    freeze();
    const status = readOnshapeImportStatus({
      startedAt: at(-5_000),
      stage: "assets",
      done: 3,
      total: 9
    });
    expect(status).toMatchObject({
      running: true,
      stage: "assets",
      done: 3,
      total: 9,
      failed: false
    });
  });

  it("treats a reported failure as terminal, and keeps the reason", () => {
    freeze();
    const status = readOnshapeImportStatus({
      startedAt: at(-5_000),
      stage: "assets",
      failedAt: at(-1_000),
      error: "Onshape API error (429)"
    });
    expect(status).toMatchObject({
      running: false,
      failed: true,
      stalled: false,
      error: "Onshape API error (429)"
    });
  });

  it("prefers a reported failure over a finish written alongside it", () => {
    // Both endings on one marker means something wrote a finish after a
    // failure. The failure is what the user needs told.
    freeze();
    const status = readOnshapeImportStatus({
      startedAt: at(-5_000),
      finishedAt: at(-2_000),
      failedAt: at(-1_000),
      error: "boom"
    });
    expect(status.failed).toBe(true);
    expect(status.justFinished).toBe(false);
  });

  it("calls a start with no ending FAILED once it outlives the cap", () => {
    // The one case a blocking UI must not spin on: a run killed outside the
    // onFailure path reaches neither ending, so staleness is the only signal.
    freeze();
    const status = readOnshapeImportStatus({
      startedAt: at(-(STALE_AFTER_MS + 1))
    });
    expect(status).toMatchObject({
      running: false,
      failed: true,
      stalled: true,
      error: null
    });
  });

  it("is still running one millisecond inside the cap", () => {
    freeze();
    expect(
      readOnshapeImportStatus({ startedAt: at(-(STALE_AFTER_MS - 1)) }).running
    ).toBe(true);
  });

  it("reports a fresh finish with its attention count", () => {
    freeze();
    const status = readOnshapeImportStatus({
      startedAt: at(-60_000),
      finishedAt: at(-1_000),
      attentionCount: 2
    });
    expect(status).toMatchObject({
      running: false,
      justFinished: true,
      attentionCount: 2
    });
  });

  it("stops calling an old finish fresh", () => {
    freeze();
    const status = readOnshapeImportStatus({
      startedAt: at(-600_000),
      finishedAt: at(-120_000),
      attentionCount: 2
    });
    expect(status.justFinished).toBe(false);
    expect(status.running).toBe(false);
  });
});
