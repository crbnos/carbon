// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  applyBatchToRecord,
  describePublishForNotification,
  failPublishRecord,
  isFinalBatch,
  MOUNT_PUBLISH_MAX_BATCHES,
  type MountPublishRun,
  startPublishRecord
} from "./outcome";
import type { MountPublishSummary } from "./publish";

const RUN: MountPublishRun = {
  runId: "run_1",
  requestId: "req_1",
  trigger: "manual",
  startedAt: "2026-10-08T10:00:00.000Z"
};

function summary(
  overrides: Partial<MountPublishSummary> = {}
): MountPublishSummary {
  return {
    entityType: "item",
    created: 0,
    updated: 0,
    ambiguous: [],
    failed: [],
    warnings: [],
    more: false,
    deferred: [],
    ...overrides
  };
}

describe("startPublishRecord", () => {
  it("starts counting from nothing but keeps the ids that keep failing", () => {
    const previous = {
      ...startPublishRecord(undefined, { ...RUN, runId: "run_0" }),
      status: "completed" as const,
      created: 40,
      failed: [{ entityId: "i9", reason: "rejected" }],
      deferred: ["i9"]
    };

    const record = startPublishRecord(previous, RUN);

    expect(record.status).toBe("running");
    expect(record.runId).toBe("run_1");
    expect(record.requestId).toBe("req_1");
    expect(record.created).toBe(0);
    expect(record.failed).toEqual([]);
    expect(record.deferred).toEqual(["i9"]);
  });
});

describe("applyBatchToRecord", () => {
  it("reports the whole run, not its last batch", () => {
    let record = startPublishRecord(undefined, RUN);
    record = applyBatchToRecord(record, summary({ created: 200, more: true }), {
      final: false,
      at: "t1"
    });
    expect(record.status).toBe("running");

    record = applyBatchToRecord(record, summary({ created: 30, updated: 5 }), {
      final: true,
      at: "t2"
    });

    expect(record.status).toBe("completed");
    expect(record.created).toBe(230);
    expect(record.updated).toBe(5);
    expect(record.more).toBe(false);
    expect(record.at).toBe("t2");
  });

  it("drops a record from the list once a later batch publishes it", () => {
    let record = startPublishRecord(undefined, RUN);
    record = applyBatchToRecord(
      record,
      summary({
        created: 1,
        failed: [{ entityId: "i0", identifier: "P-0", reason: "timeout" }],
        deferred: ["i0"],
        more: true
      }),
      { final: false, at: "t1" }
    );

    // The last batch had room for the deferred record and it went through.
    record = applyBatchToRecord(record, summary({ updated: 1 }), {
      final: true,
      at: "t2"
    });

    expect(record.failed).toEqual([]);
    expect(record.deferred).toEqual([]);
  });

  it("keeps an earlier failure the later batch did not reach", () => {
    let record = startPublishRecord(undefined, RUN);
    record = applyBatchToRecord(
      record,
      summary({
        created: 1,
        failed: [{ entityId: "i0", identifier: "P-0", reason: "rejected" }],
        deferred: ["i0"],
        more: true
      }),
      { final: false, at: "t1" }
    );

    record = applyBatchToRecord(
      record,
      summary({ created: 2, deferred: ["i0"], more: true }),
      { final: true, at: "t2" }
    );

    expect(record.failed).toEqual([
      { entityId: "i0", identifier: "P-0", reason: "rejected" }
    ]);
    expect(record.more).toBe(true);
  });

  it("reports a record once when it fails again in a later batch", () => {
    let record = startPublishRecord(undefined, RUN);
    const failure = { entityId: "i0", identifier: "P-0", reason: "rejected" };
    record = applyBatchToRecord(
      record,
      summary({ created: 1, failed: [failure], deferred: ["i0"], more: true }),
      { final: false, at: "t1" }
    );
    record = applyBatchToRecord(
      record,
      summary({ failed: [failure], deferred: ["i0"] }),
      { final: true, at: "t2" }
    );

    expect(record.failed).toEqual([failure]);
  });

  it("reports a setting that stopped the batch as the run's error, not a record", () => {
    const reason = 'Part definition slug "partz" isn\'t in Mount.';
    const batch = summary({ failed: [{ entityId: "*", reason }] });

    const record = applyBatchToRecord(
      startPublishRecord(undefined, RUN),
      batch,
      { final: isFinalBatch(batch, 0), at: "t1" }
    );

    expect(record.status).toBe("failed");
    expect(record.error).toBe(reason);
    expect(record.failed).toEqual([]);
    expect(
      describePublishForNotification([{ entityType: "item", record }])
    ).toEqual({
      title: "Mount push failed",
      body: `Parts: the push failed. ${reason} Open the Mount integration for details.`
    });
  });
});

describe("isFinalBatch", () => {
  it("keeps going while records remain and the batch published some", () => {
    expect(isFinalBatch(summary({ created: 200, more: true }), 0)).toBe(false);
  });

  it("stops when nothing is left", () => {
    expect(isFinalBatch(summary({ created: 12 }), 0)).toBe(true);
  });

  it("stops when a whole batch published nothing", () => {
    const failed = Array.from({ length: 200 }, (_, i) => ({
      entityId: `i${i}`,
      reason: "Title is required"
    }));
    expect(isFinalBatch(summary({ failed, more: true }), 0)).toBe(true);
  });

  it("stops at the batch limit even with records left", () => {
    expect(
      isFinalBatch(
        summary({ created: 200, more: true }),
        MOUNT_PUBLISH_MAX_BATCHES - 1
      )
    ).toBe(true);
  });
});

describe("failPublishRecord", () => {
  it("keeps what the run already counted", () => {
    const running = applyBatchToRecord(
      startPublishRecord(undefined, RUN),
      summary({ created: 200, more: true }),
      { final: false, at: "t1" }
    );

    const record = failPublishRecord(running, RUN, "Mount answered 503", "t2");

    expect(record.status).toBe("failed");
    expect(record.created).toBe(200);
    expect(record.error).toBe("Mount answered 503");
  });

  it("does not report another run's counts as this one's", () => {
    const previous = applyBatchToRecord(
      startPublishRecord(undefined, { ...RUN, runId: "run_0" }),
      summary({ created: 80, deferred: ["i3"] }),
      { final: true, at: "t0" }
    );

    const record = failPublishRecord(previous, RUN, "Mount answered 401", "t1");

    expect(record.runId).toBe("run_1");
    expect(record.created).toBe(0);
    expect(record.deferred).toEqual(["i3"]);
  });
});

describe("describePublishForNotification", () => {
  it("stays quiet when the run needs nothing", () => {
    const record = applyBatchToRecord(
      startPublishRecord(undefined, RUN),
      summary({ created: 12 }),
      { final: true, at: "t1" }
    );

    expect(
      describePublishForNotification([{ entityType: "item", record }])
    ).toBeNull();
  });

  it("names the stuck records and what is left", () => {
    const record = applyBatchToRecord(
      startPublishRecord(undefined, RUN),
      summary({
        created: 10,
        updated: 2,
        failed: [{ entityId: "i1", reason: "rejected" }],
        ambiguous: [{ entityId: "i2", identifier: "P-2", matches: 2 }],
        deferred: ["i1", "i2"],
        more: true
      }),
      { final: true, at: "t1" }
    );

    expect(
      describePublishForNotification([{ entityType: "item", record }])
    ).toEqual({
      title: "Mount push needs attention",
      body: "Parts: 12 sent, 2 records need attention, more remain. Open the Mount integration for details."
    });
  });

  it("leads with the failure when the run failed", () => {
    const record = failPublishRecord(
      undefined,
      RUN,
      "Mount answered 401: invalid_client",
      "t1"
    );

    expect(
      describePublishForNotification([{ entityType: "customer", record }])
    ).toEqual({
      title: "Mount push failed",
      body: "Customers: the push failed. Mount answered 401: invalid_client Open the Mount integration for details."
    });
  });
});
