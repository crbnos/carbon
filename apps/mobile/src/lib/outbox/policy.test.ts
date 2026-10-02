// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { ApiClientError, networkError } from "../api/errors";
import {
  afterFailure,
  afterInterrupt,
  afterOperatorRetry,
  ageMs,
  BACKOFF_MAX_MS,
  canSendAsOperator,
  classify,
  confirmPatch,
  dispositionOf,
  isDue,
  isStale,
  laneHead,
  nextDelayMs,
  nowIso,
  OPERATOR_REQUIRED_CODE,
  operatorUnavailablePatch,
  plusMs,
  STALE_AFTER_MS,
  selectLaneHeads,
  summarize
} from "./policy";
import type { OutboxRow } from "./schema";

/**
 * The outbox's decisions, tested as what they are: pure functions over plain
 * values. There is no fake sqlite and no fake API client here — `queue.ts` is
 * the glue that reads a row, asks these functions, and writes the answer back,
 * and faking both of its collaborators to count calls would pin the wiring
 * rather than the rules (`.claude/rules/testing-no-mock-theater.md`).
 *
 * The one rule worth a whole file: a retry that reuses the idempotency key is
 * only safe when the command provably did not run. Everything below exists to
 * fail if that stops being true.
 */

const T0 = "2026-10-02T08:00:00.000Z";

function row(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    seq: 1,
    id: "ob1",
    instanceId: "inst1",
    companyId: "comp1",
    sessionUserId: "user1",
    operatorUserId: null,
    operationId: "op1",
    lane: "op1",
    method: "POST",
    path: "/operations/op1/quantities",
    body: '{"quantity":5}',
    kind: "report-good",
    label: "Report 5 good",
    idempotencyKey: "key-1",
    createdAt: T0,
    attempts: 0,
    state: "queued",
    lastError: null,
    lastErrorCode: null,
    nextAttemptAt: null,
    confirmedAt: null,
    ...over
  };
}

describe("classify", () => {
  it("retries under the same key only what provably did not run", () => {
    expect(classify(networkError())).toBe("retry_same_key");
    expect(
      classify(new ApiClientError(503, "retry_later", "Redis is down"))
    ).toBe("retry_same_key");
    expect(
      classify(new ApiClientError(409, "request_in_progress", "Still working"))
    ).toBe("retry_same_key");
  });

  it("sends a stored 5xx to the operator instead of retrying it", () => {
    // The server replays a stored 500 under the same key, so an automatic
    // retry would never succeed — and a NEW key would re-run a command that
    // may have partly applied. Only the operator may make that call.
    expect(classify(new ApiClientError(500, "internal", "boom"))).toBe(
      "needs_attention"
    );
  });

  it("sends every other refusal to the operator", () => {
    expect(classify(new ApiClientError(403, "forbidden", "No"))).toBe(
      "needs_attention"
    );
    expect(classify(new ApiClientError(409, "conflict", "Already done"))).toBe(
      "needs_attention"
    );
    expect(
      classify(new ApiClientError(422, "idempotency_key_reused", "Reused"))
    ).toBe("needs_attention");
    expect(
      classify(new ApiClientError(400, "validation_failed", "Check it"))
    ).toBe("needs_attention");
  });

  it("names an expired operator, which stops the lane like any refusal", () => {
    expect(
      classify(new ApiClientError(401, "operator_expired", "Pin in again"))
    ).toBe("operator_expired");
  });
});

describe("nextDelayMs", () => {
  it("doubles from two seconds", () => {
    expect(nextDelayMs(0)).toBe(2_000);
    expect(nextDelayMs(1)).toBe(4_000);
    expect(nextDelayMs(2)).toBe(8_000);
    expect(nextDelayMs(3)).toBe(16_000);
  });

  it("caps at a minute, however many attempts have gone by", () => {
    expect(nextDelayMs(5)).toBe(BACKOFF_MAX_MS);
    expect(nextDelayMs(40)).toBe(BACKOFF_MAX_MS);
    // 2 ** 2000 is Infinity; the cap still has to hold.
    expect(nextDelayMs(2_000)).toBe(BACKOFF_MAX_MS);
  });

  it("treats a nonsense attempt count as the first attempt", () => {
    expect(nextDelayMs(-3)).toBe(2_000);
  });
});

describe("the eight-hour stale hold", () => {
  it("holds a row made before the last shift change", () => {
    expect(isStale(T0, plusMs(T0, STALE_AFTER_MS + 1))).toBe(true);
    expect(isStale(T0, plusMs(T0, 24 * 60 * 60 * 1000))).toBe(true);
  });

  it("does not hold a row at exactly eight hours", () => {
    // The boundary falls towards sending: a row made seconds before the
    // cutoff should not need a tap.
    expect(isStale(T0, plusMs(T0, STALE_AFTER_MS))).toBe(false);
    expect(isStale(T0, plusMs(T0, STALE_AFTER_MS - 1))).toBe(false);
  });

  it("does not hold a fresh row", () => {
    expect(isStale(T0, plusMs(T0, 30_000))).toBe(false);
    expect(isStale(T0, T0)).toBe(false);
  });
});

describe("isDue", () => {
  it("is due with no backoff set", () => {
    expect(isDue(null, T0)).toBe(true);
  });

  it("is due once the backoff has elapsed, and at the instant it expires", () => {
    expect(isDue(T0, plusMs(T0, 1))).toBe(true);
    expect(isDue(T0, T0)).toBe(true);
  });

  it("is not due while the backoff is still running", () => {
    expect(isDue(plusMs(T0, 2_000), T0)).toBe(false);
  });
});

describe("dispositionOf", () => {
  it("sends a due, fresh, queued row", () => {
    expect(dispositionOf(row(), T0)).toBe("send");
  });

  it("waits out a backoff", () => {
    expect(dispositionOf(row({ nextAttemptAt: plusMs(T0, 4_000) }), T0)).toBe(
      "waiting"
    );
  });

  it("reports a row the queue is already sending", () => {
    expect(dispositionOf(row({ state: "sending" }), T0)).toBe("sending");
  });

  it("stops at a failure the operator has to resolve", () => {
    expect(dispositionOf(row({ state: "needs_attention" }), T0)).toBe(
      "needs_attention"
    );
  });

  it("asks before sending anything older than a shift", () => {
    const later = plusMs(T0, STALE_AFTER_MS + 60_000);
    expect(dispositionOf(row(), later)).toBe("needs_confirmation");
  });

  it("sends a stale row the operator has okayed", () => {
    const later = plusMs(T0, STALE_AFTER_MS + 60_000);
    expect(dispositionOf(row(confirmPatch(later)), later)).toBe("send");
  });

  it("keeps a confirmed row blocked when it ALSO failed", () => {
    const later = plusMs(T0, STALE_AFTER_MS + 60_000);
    expect(
      dispositionOf(
        row({ ...confirmPatch(later), state: "needs_attention" }),
        later
      )
    ).toBe("needs_attention");
  });
});

describe("lanes", () => {
  const rows = [
    row({ seq: 1, id: "a", operationId: "op1", lane: "op1" }),
    row({ seq: 2, id: "b", operationId: "op1", lane: "op1" }),
    row({ seq: 3, id: "c", operationId: null, lane: "general" }),
    row({ seq: 4, id: "d", operationId: "op2", lane: "op2" })
  ];

  it("takes the oldest row of a lane, whatever order the rows arrive in", () => {
    expect(laneHead([...rows].reverse(), "op1")?.id).toBe("a");
    expect(laneHead(rows, "general")?.id).toBe("c");
    expect(laneHead(rows, "op3")).toBeNull();
  });

  it("gives every lane with work exactly one head", () => {
    const heads = selectLaneHeads(rows, T0);
    expect(heads.map((h) => h.lane)).toEqual(["op1", "general", "op2"]);
    expect(heads.map((h) => h.row.id)).toEqual(["a", "c", "d"]);
    expect(heads.every((h) => h.disposition === "send")).toBe(true);
  });

  it("stops one jammed lane without stopping the floor", () => {
    const jammed = [
      row({
        seq: 1,
        id: "a",
        operationId: "op1",
        lane: "op1",
        state: "needs_attention"
      }),
      row({ seq: 2, id: "b", operationId: "op1", lane: "op1" }),
      row({ seq: 3, id: "d", operationId: "op2", lane: "op2" })
    ];
    const heads = selectLaneHeads(jammed, T0);
    const op1 = heads.find((h) => h.lane === "op1");
    const op2 = heads.find((h) => h.lane === "op2");
    // The second op1 row is never offered: order within an operation holds.
    expect(op1?.row.id).toBe("a");
    expect(op1?.disposition).toBe("needs_attention");
    expect(op2?.row.id).toBe("d");
    expect(op2?.disposition).toBe("send");
  });
});

describe("afterFailure", () => {
  it("keeps the key and backs off when the command did not run", () => {
    const patch = afterFailure(row({ attempts: 0 }), networkError(), T0);
    expect(patch.state).toBe("queued");
    expect(patch.attempts).toBe(1);
    expect(patch.nextAttemptAt).toBe(plusMs(T0, 2_000));
    expect(patch.lastErrorCode).toBe("network");
    // Not mentioning the key is what makes the resend a de-duplicated replay.
    expect(patch).not.toHaveProperty("idempotencyKey");
  });

  it("lengthens the backoff with each attempt, up to the cap", () => {
    expect(
      afterFailure(row({ attempts: 2 }), networkError(), T0).nextAttemptAt
    ).toBe(plusMs(T0, 8_000));
    expect(
      afterFailure(row({ attempts: 9 }), networkError(), T0).nextAttemptAt
    ).toBe(plusMs(T0, BACKOFF_MAX_MS));
  });

  it("stops the lane on a stored 5xx and keeps the server's words", () => {
    const err = new ApiClientError(500, "internal", "Could not post the event");
    const patch = afterFailure(row({ attempts: 1 }), err, T0);
    expect(patch.state).toBe("needs_attention");
    expect(patch.nextAttemptAt).toBeNull();
    expect(patch.lastError).toBe("Could not post the event");
    expect(patch.lastErrorCode).toBe("internal");
    expect(patch).not.toHaveProperty("idempotencyKey");
  });

  it("stops the lane on an expired operator", () => {
    const err = new ApiClientError(401, "operator_expired", "Pin in again");
    expect(afterFailure(row(), err, T0).state).toBe("needs_attention");
  });
});

describe("canSendAsOperator", () => {
  it("sends a row nobody was pinned in for, on a single-user device", () => {
    expect(canSendAsOperator(row({ operatorUserId: null }), null)).toBe(true);
    // A tablet that has since become a shared terminal does not retroactively
    // claim a row made before anyone pinned in.
    expect(canSendAsOperator(row({ operatorUserId: null }), "opB")).toBe(true);
  });

  it("sends an operator's row while that operator is still at the tablet", () => {
    expect(canSendAsOperator(row({ operatorUserId: "opA" }), "opA")).toBe(true);
  });

  it("refuses to send A's work under B's PIN session", () => {
    // A reports five good, the Wi-Fi drops, A pins out and B pins in. Sending
    // now would credit B with A's work, and `productionEvent.createdBy` is
    // what a shop floor's hours are paid from.
    expect(canSendAsOperator(row({ operatorUserId: "opA" }), "opB")).toBe(
      false
    );
    expect(canSendAsOperator(row({ operatorUserId: "opA" }), null)).toBe(false);
  });
});

describe("operatorUnavailablePatch", () => {
  it("refuses to send without burning an attempt or storing a sentence", () => {
    const patch = operatorUnavailablePatch();
    expect(patch.state).toBe("needs_attention");
    expect(patch.lastError).toBeNull();
    expect(patch.lastErrorCode).toBe(OPERATOR_REQUIRED_CODE);
    // Nothing was attempted, so the attempt count must not move.
    expect(patch).not.toHaveProperty("attempts");
  });
});

describe("afterOperatorRetry", () => {
  it("takes a NEW key, which is the only safe way out of needs-attention", () => {
    const before = row({
      state: "needs_attention",
      attempts: 3,
      lastError: "boom",
      lastErrorCode: "internal"
    });
    const patch = afterOperatorRetry("key-2", T0);
    expect(patch.idempotencyKey).toBe("key-2");
    expect(patch.idempotencyKey).not.toBe(before.idempotencyKey);
    expect(patch.state).toBe("queued");
    expect(patch.attempts).toBe(0);
    expect(patch.nextAttemptAt).toBeNull();
    expect(patch.lastError).toBeNull();
    expect(patch.lastErrorCode).toBeNull();
  });

  it("counts as okaying a stale row, since the operator just read it", () => {
    const later = plusMs(T0, STALE_AFTER_MS + 60_000);
    const patch = afterOperatorRetry("key-2", later);
    expect(dispositionOf(row(patch), later)).toBe("send");
  });
});

describe("afterInterrupt", () => {
  it("re-queues a row the app was killed mid-send, under the same key", () => {
    const patch = afterInterrupt(row({ state: "sending" }));
    expect(patch).toEqual({ state: "queued", nextAttemptAt: null });
    // The request may have arrived. Same key means the server either answers
    // request_in_progress or replays what it stored — never a second write.
    expect(patch).not.toHaveProperty("idempotencyKey");
  });

  it("leaves every other state alone", () => {
    expect(afterInterrupt(row({ state: "queued" }))).toBeNull();
    expect(afterInterrupt(row({ state: "needs_attention" }))).toBeNull();
  });
});

describe("summarize", () => {
  it("counts nothing for an empty queue, so no banner can show", () => {
    expect(summarize([], T0).total).toBe(0);
  });

  it("counts each kind, the lanes, and names the oldest row", () => {
    const later = plusMs(T0, 1_000);
    const rows = [
      row({ seq: 2, id: "b", label: "Report 5 good" }),
      row({ seq: 1, id: "a", label: "Start labor" }),
      row({ seq: 3, id: "c", state: "sending" }),
      row({ seq: 4, id: "d", state: "needs_attention" }),
      row({
        seq: 5,
        id: "e",
        operationId: null,
        lane: "general",
        nextAttemptAt: plusMs(later, 10_000)
      })
    ];
    const summary = summarize(rows, later);
    expect(summary.total).toBe(5);
    expect(summary.waiting).toBe(3);
    expect(summary.sending).toBe(1);
    expect(summary.needsAttention).toBe(1);
    expect(summary.needsConfirmation).toBe(0);
    expect(summary.lanes).toBe(2);
    expect(summary.oldestLabel).toBe("Start labor");
    expect(summary.oldestCreatedAt).toBe(T0);
  });

  it("counts a row left over from the last shift as needing confirmation", () => {
    const later = plusMs(T0, STALE_AFTER_MS + 60_000);
    const summary = summarize([row()], later);
    expect(summary.needsConfirmation).toBe(1);
    expect(summary.waiting).toBe(0);
  });
});

describe("the clock", () => {
  it("measures and advances instants without JavaScript Date arithmetic", () => {
    expect(ageMs(T0, plusMs(T0, 1_500))).toBe(1_500);
    expect(ageMs(plusMs(T0, 1_500), T0)).toBe(-1_500);
  });

  it("reads the current instant as an ISO string it can parse back", () => {
    const iso = nowIso();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(ageMs(iso, iso)).toBe(0);
  });
});
