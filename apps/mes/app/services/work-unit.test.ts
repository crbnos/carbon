// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { childrenConsumedInto } from "./operations.service";
import {
  decideWorkUnit,
  type OperationUnitFacts,
  resolveWorkUnit,
  SELECT_UNIT_FIRST
} from "./work-unit.server";
import {
  fakeClient,
  serialOperation,
  serialUnits
} from "./work-unit-test-fixture";

const op = "op_2";
const facts = (over: Partial<OperationUnitFacts> = {}): OperationUnitFacts => ({
  jobMakeMethodId: "jmm",
  serial: true,
  batch: false,
  isFirstOperation: false,
  operationQuantity: null,
  ...over
});
const unit = (
  id: string,
  over: { done?: boolean; inOperationScope?: boolean; status?: string } = {}
) => ({
  id,
  status: (over.status ?? "Reserved") as "Reserved",
  attributes: over.done ? { [`Operation ${op}`]: 0 } : {},
  inOperationScope: over.inOperationScope
});
const decide = (args: Partial<Parameters<typeof decideWorkUnit>[0]>) =>
  decideWorkUnit({
    facts: facts(),
    units: [unit("u1", { done: true }), unit("u2"), unit("u3")],
    operationId: op,
    requestedUnitId: null,
    mode: "require",
    ...args
  });

describe("decideWorkUnit", () => {
  it("takes the next open unit on a first operation for a kanban scan", () => {
    expect(
      decide({ facts: facts({ isFirstOperation: true }), mode: "advance" })
    ).toEqual({
      kind: "unit",
      unitId: "u2",
      unitIndex: 1,
      isFirstOperation: true,
      via: "advanced"
    });
  });

  it("takes no finished unit on a first operation with every unit done", () => {
    expect(
      decide({
        facts: facts({ isFirstOperation: true }),
        mode: "advance",
        units: [unit("u1", { done: true }), unit("u2", { done: true })]
      })
    ).toEqual({ kind: "refuse", pickUnit: false, message: expect.any(String) });
  });

  it("keys an older tablet's step by its index on a first operation only", () => {
    expect(
      decide({ facts: facts({ isFirstOperation: true }), legacyUnitIndex: 2 })
    ).toMatchObject({ kind: "unit", unitId: "u3", unitIndex: 2, via: "named" });
    expect(decide({ legacyUnitIndex: 2 })).toEqual({
      kind: "refuse",
      pickUnit: true,
      message: SELECT_UNIT_FIRST
    });
  });

  it("decides the one unit left from the units the operation works", () => {
    // Quantity 2: u3 is a pre-generated unit past it, not on the screen.
    expect(decide({ facts: facts({ operationQuantity: 2 }) })).toMatchObject({
      kind: "unit",
      unitId: "u2",
      via: "sole"
    });
  });

  it("asks for the unit on a later operation when none is named", () => {
    for (const mode of ["advance", "require"] as const) {
      expect(decide({ mode })).toEqual({
        kind: "refuse",
        pickUnit: true,
        message: SELECT_UNIT_FIRST
      });
    }
  });

  it("takes the one unit left on a later operation", () => {
    expect(
      decide({
        units: [
          unit("u1", { done: true }),
          unit("u2"),
          unit("u3", { done: true })
        ]
      })
    ).toEqual({
      kind: "unit",
      unitId: "u2",
      unitIndex: 1,
      isFirstOperation: false,
      via: "sole"
    });
  });

  it("keys a named unit by its place in the full axis", () => {
    expect(decide({ requestedUnitId: "u3" })).toEqual({
      kind: "unit",
      unitId: "u3",
      unitIndex: 2,
      isFirstOperation: false,
      via: "named"
    });
  });

  it("refuses a unit of another job, outside the operation, or done here", () => {
    expect(decide({ requestedUnitId: "u9" })).toMatchObject({
      kind: "refuse",
      pickUnit: true
    });
    expect(
      decide({
        units: [
          unit("u1", { inOperationScope: false }),
          unit("u2"),
          unit("u3")
        ],
        requestedUnitId: "u1"
      })
    ).toMatchObject({ kind: "refuse", pickUnit: true });
    expect(decide({ requestedUnitId: "u1" })).toMatchObject({
      kind: "refuse",
      pickUnit: true
    });
  });

  it("lets a quality issue name a unit already done here", () => {
    expect(decide({ requestedUnitId: "u1", mode: "member" })).toMatchObject({
      kind: "unit",
      unitId: "u1"
    });
    expect(decide({ mode: "member" })).toEqual({ kind: "none" });
  });

  it("names no unit on a timer start with none held on a later operation", () => {
    expect(decide({ mode: "optional" })).toEqual({ kind: "none" });
  });

  it("runs a first operation's timer on the next open unit, else on none", () => {
    const first = facts({ isFirstOperation: true });
    expect(decide({ facts: first, mode: "optional" })).toMatchObject({
      kind: "unit",
      unitId: "u2",
      via: "advanced"
    });
    expect(
      decide({ facts: first, mode: "optional", requestedUnitId: "u1" })
    ).toMatchObject({ kind: "unit", unitId: "u2", via: "advanced" });
    expect(
      decide({
        facts: first,
        mode: "optional",
        requestedUnitId: "u1",
        units: [unit("u1", { done: true })]
      })
    ).toEqual({ kind: "none" });
  });

  it("starts a later operation's timer naming no unit when the named one is done or outside", () => {
    expect(decide({ mode: "optional", requestedUnitId: "u1" })).toEqual({
      kind: "none"
    });
    expect(
      decide({
        mode: "optional",
        units: [unit("u1", { inOperationScope: false }), unit("u2")],
        requestedUnitId: "u1"
      })
    ).toEqual({ kind: "none" });
    expect(decide({ mode: "optional", requestedUnitId: "u9" })).toMatchObject({
      kind: "refuse"
    });
    expect(
      decide({
        facts: facts({ serial: false, batch: true }),
        mode: "optional",
        requestedUnitId: "lot"
      })
    ).toEqual({ kind: "none", lotId: "lot" });
  });

  it("takes a traveler claim on a later operation only into the held or last unit", () => {
    expect(
      decide({ mode: "claim", requestedUnitId: "u3", heldUnitId: null })
    ).toMatchObject({ kind: "refuse", pickUnit: true });
    expect(
      decide({ mode: "claim", requestedUnitId: "u3", heldUnitId: "u3" })
    ).toMatchObject({ kind: "unit", unitId: "u3" });
    expect(
      decide({
        facts: facts({ isFirstOperation: true }),
        mode: "claim",
        requestedUnitId: "u3",
        heldUnitId: "u2"
      })
    ).toMatchObject({ kind: "unit", unitId: "u3" });
  });

  it("names no unit for a part that is not serial", () => {
    expect(decide({ facts: facts({ serial: false }) })).toEqual({
      kind: "none"
    });
  });

  it("gives a batch kanban scan its lot", () => {
    expect(
      decide({
        facts: facts({ serial: false, batch: true }),
        mode: "advance",
        units: [unit("lot", { status: "Available" })]
      })
    ).toEqual({ kind: "none", lotId: "lot" });
  });

  it("skips units outside a rework's scope when it advances", () => {
    expect(
      decide({
        facts: facts({ isFirstOperation: true }),
        mode: "advance",
        units: [
          unit("u1", { inOperationScope: false }),
          unit("u2", { inOperationScope: false }),
          unit("u3")
        ]
      })
    ).toMatchObject({ kind: "unit", unitId: "u3", unitIndex: 2 });
  });
});

describe("resolveWorkUnit", () => {
  const tables = (later: boolean) => ({
    jobOperation: [serialOperation({ id: op, jobMakeMethodId: "jmm", later })],
    trackedEntity: serialUnits("jmm", op, [{ id: "u1" }, { id: "u2" }])
  });

  it("reads the operation and its units for the company only", async () => {
    const fake = fakeClient(tables(true));
    await resolveWorkUnit({
      client: fake.client,
      companyId: "co",
      operationId: op,
      requestedUnitId: "u2",
      mode: "require"
    });
    expect(fake.calls.map((call) => call.table)).toEqual([
      "jobOperation",
      "trackedEntity",
      "jobOperationTrackedEntity"
    ]);
    for (const call of fake.calls) {
      expect(call.filters).toContainEqual(["companyId", "co"]);
    }
  });

  it("decides first or later from the operation's dependencies", async () => {
    const first = await resolveWorkUnit({
      client: fakeClient(tables(false)).client,
      companyId: "co",
      operationId: op,
      mode: "advance"
    });
    const later = await resolveWorkUnit({
      client: fakeClient(tables(true)).client,
      companyId: "co",
      operationId: op,
      mode: "advance"
    });
    expect(first).toMatchObject({ kind: "unit", unitId: "u1" });
    expect(later).toMatchObject({ kind: "refuse", pickUnit: true });
  });

  it("does not find another company's operation", async () => {
    expect(
      await resolveWorkUnit({
        client: fakeClient(tables(false)).client,
        companyId: "other",
        operationId: op,
        mode: "advance"
      })
    ).toMatchObject({ kind: "refuse", pickUnit: false });
  });

  it("finds a named unit past the first 1000 of a large job", async () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({ id: `u${i + 1}` }));
    const fake = fakeClient({
      jobOperation: [
        serialOperation({
          id: op,
          jobMakeMethodId: "jmm",
          later: true,
          extra: { operationQuantity: 1001 }
        })
      ],
      trackedEntity: serialUnits("jmm", op, many)
    });
    expect(
      await resolveWorkUnit({
        client: fake.client,
        companyId: "co",
        operationId: op,
        requestedUnitId: "u1001",
        mode: "require"
      })
    ).toMatchObject({ kind: "unit", unitId: "u1001", unitIndex: 1000 });
  });

  it("reads no units for a timer start that names none", async () => {
    const fake = fakeClient(tables(true));
    await resolveWorkUnit({
      client: fake.client,
      companyId: "co",
      operationId: op,
      mode: "optional"
    });
    expect(fake.calls.map((call) => call.table)).toEqual(["jobOperation"]);
  });
});

describe("childrenConsumedInto", () => {
  const consumed = (
    child: string,
    parent: string,
    createdAt: string,
    type = "Consume"
  ) => ({
    trackedEntityId: child,
    companyId: "co",
    trackedActivity: {
      type,
      createdAt,
      trackedActivityOutput: [{ trackedEntityId: parent }]
    }
  });
  const check = (rows: ReturnType<typeof consumed>[], childIds: string[]) =>
    childrenConsumedInto(fakeClient({ trackedActivityInput: rows }).client, {
      companyId: "co",
      parentTrackedEntityId: "P",
      childIds
    });

  it("passes parts consumed into the unit", async () => {
    expect(
      await check(
        [
          consumed("c1", "P", "2026-01-01T00:00:00Z"),
          consumed("c2", "P", "2026-01-01T00:00:00Z")
        ],
        ["c1", "c2"]
      )
    ).toEqual({ data: true, error: null });
  });

  it("refuses a part consumed into another unit, or never consumed", async () => {
    // c1 went into P, was given back, then went into Q.
    expect(
      await check(
        [
          consumed("c1", "P", "2026-01-01T00:00:00Z"),
          consumed("c1", "Q", "2026-01-02T00:00:00Z")
        ],
        ["c1"]
      )
    ).toEqual({ data: false, error: null });
    expect(
      await check([consumed("c1", "P", "2026-01-01T00:00:00Z")], ["c1", "c2"])
    ).toEqual({ data: false, error: null });
    expect(
      await check(
        [consumed("c1", "P", "2026-01-01T00:00:00Z", "Unconsume")],
        ["c1"]
      )
    ).toEqual({ data: false, error: null });
  });
});
