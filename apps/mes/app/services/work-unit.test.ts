// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { type HoldingIssue, unitOnHoldMessage } from "~/utils/unitHold";
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

  it("starts a kanban timer with no unit on a later operation with several open", () => {
    expect(decide({ mode: "start" })).toEqual({ kind: "none" });
  });

  it("starts a kanban timer on the next open unit of a first operation", () => {
    expect(
      decide({ facts: facts({ isFirstOperation: true }), mode: "start" })
    ).toMatchObject({ kind: "unit", unitId: "u2", via: "advanced" });
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

const issue = (
  readableId: string,
  over: Partial<HoldingIssue> = {}
): HoldingIssue => ({
  id: readableId,
  readableId,
  name: "Cracked housing",
  description: null,
  type: "Defect",
  status: "Registered",
  createdAt: "2026-01-01T00:00:00Z",
  ...over
});

describe("decideWorkUnit with a unit on hold", () => {
  const onHold = { u2: [issue("NCR-1")] };
  const refused = {
    kind: "refuse",
    pickUnit: true,
    message: "This unit is on hold for issue NCR-1"
  };

  it("keeps a Reserved replacement selectable after ordinary MES scrap with quality holds off", () => {
    const args = {
      facts: facts({ operationQuantity: 1 }),
      units: [unit("scrapped", { status: "Scrapped" }), unit("replacement")]
    };
    expect(decide(args)).toMatchObject({
      kind: "unit",
      unitId: "replacement",
      unitIndex: 1
    });
  });

  it("selects an appended Reserved replacement without changing its step-record index", () => {
    const units = [
      unit("u1", { done: true }),
      unit("u2", { done: true }),
      unit("u3"),
      unit("u4", { done: true }),
      unit("replacement")
    ];
    const args = {
      units,
      onHold: { u3: [issue("NCR-3")] },
      facts: facts({ operationQuantity: 4 })
    };
    expect(decide(args)).toMatchObject({
      kind: "unit",
      unitId: "replacement",
      unitIndex: 4,
      via: "sole"
    });
    expect(
      decide({ ...args, requestedUnitId: "replacement", mode: "claim" })
    ).toMatchObject({ kind: "unit", unitId: "replacement" });
    units[4] = unit("replacement", { done: true });
    expect(decide({ ...args, onHold: {} })).toMatchObject({ kind: "refuse" });
    expect(
      decide({ ...args, onHold: {}, requestedUnitId: "u3" })
    ).toMatchObject({ kind: "refuse" });
  });

  it("refuses every write that needs the unit open, with the issue number", () => {
    for (const mode of ["require", "advance", "start"] as const) {
      expect(decide({ onHold, requestedUnitId: "u2", mode })).toEqual(refused);
    }
    expect(
      decide({ onHold, requestedUnitId: "u2", mode: "claim", heldUnitId: "u2" })
    ).toEqual(refused);
  });

  it("names every issue that holds the unit", () => {
    expect(unitOnHoldMessage([issue("NCR-1"), issue("NCR-2")])).toBe(
      "This unit is on hold for issues NCR-1, NCR-2"
    );
  });

  it("lets a quality issue, a correction or an unconsume name it", () => {
    expect(
      decide({ onHold, requestedUnitId: "u2", mode: "member" })
    ).toMatchObject({ kind: "unit", unitId: "u2", via: "named" });
  });

  it("answers already complete for a unit done here, on hold or not", () => {
    const answer = decide({
      onHold: { u1: [issue("NCR-1")] },
      requestedUnitId: "u1"
    });
    expect(answer).toEqual(decide({ requestedUnitId: "u1" }));
    expect(answer).toMatchObject({ kind: "refuse" });
  });

  it("still takes a unit that is not on hold", () => {
    expect(decide({ onHold, requestedUnitId: "u3" })).toMatchObject({
      kind: "unit",
      unitId: "u3"
    });
  });

  it("skips it for the next unit of a first operation", () => {
    expect(
      decide({
        onHold,
        facts: facts({ isFirstOperation: true }),
        mode: "advance"
      })
    ).toMatchObject({ kind: "unit", unitId: "u3", unitIndex: 2 });
  });

  it("takes the other unit as the one left", () => {
    expect(decide({ onHold })).toMatchObject({
      kind: "unit",
      unitId: "u3",
      via: "sole"
    });
  });

  it("refuses, without asking for a unit, when every unit left is on hold", () => {
    const answer = decide({
      onHold: { u2: [issue("NCR-1")], u3: [issue("NCR-2")] },
      mode: "advance"
    });
    expect(answer).toEqual({
      kind: "refuse",
      pickUnit: false,
      message: "Every unit left at this operation is on hold"
    });
    // Not the answer for a finished operation.
    expect(answer).not.toEqual(
      decide({
        units: [unit("u1", { done: true }), unit("u2", { done: true })],
        mode: "advance"
      })
    );
  });

  it("starts a timer without it", () => {
    expect(decide({ onHold, requestedUnitId: "u2", mode: "optional" })).toEqual(
      { kind: "none" }
    );
    expect(
      decide({
        onHold,
        facts: facts({ isFirstOperation: true }),
        requestedUnitId: "u2",
        mode: "optional"
      })
    ).toMatchObject({ kind: "unit", unitId: "u3", via: "advanced" });
  });

  it("never holds a lot", () => {
    expect(
      decide({
        onHold: { lot: [issue("NCR-1")] },
        facts: facts({ serial: false, batch: true }),
        mode: "advance",
        units: [unit("lot", { status: "Available" })]
      })
    ).toEqual({ kind: "none", lotId: "lot" });
  });
});

describe("resolveWorkUnit", () => {
  const tables = (later: boolean) => ({
    jobOperation: [serialOperation({ id: op, jobMakeMethodId: "jmm", later })],
    trackedEntity: serialUnits("jmm", op, [{ id: "u1" }, { id: "u2" }])
  });
  const withIssue = (
    over: { on?: boolean; status?: string; unitId?: string } = {}
  ) => ({
    ...tables(true),
    companySettings: [{ id: "co", holdUnitsWithOpenIssues: over.on ?? true }],
    unitQualityHold:
      over.status === "Closed"
        ? []
        : [
            {
              trackedEntityId: over.unitId ?? "u2",
              companyId: "co",
              issueId: "nc_1",
              issueNumber: "NCR-1",
              name: "Cracked housing",
              description: null,
              status: over.status ?? "Registered",
              createdAt: "2026-01-01T00:00:00Z",
              issueType: "Defect"
            }
          ]
  });
  const resolve = (
    client: ReturnType<typeof fakeClient>["client"],
    args: Partial<Parameters<typeof resolveWorkUnit>[0]> = {}
  ) =>
    resolveWorkUnit({
      client,
      companyId: "co",
      operationId: op,
      requestedUnitId: "u2",
      mode: "require",
      ...args
    });

  it("refuses work on a unit with an open issue when the company holds them", async () => {
    expect(await resolve(fakeClient(withIssue()).client)).toEqual({
      kind: "refuse",
      pickUnit: true,
      message: "This unit is on hold for issue NCR-1"
    });
    expect(
      await resolve(fakeClient(withIssue()).client, { requestedUnitId: "u1" })
    ).toMatchObject({ kind: "unit", unitId: "u1" });
  });

  it("holds nothing when the company has not turned the rule on", async () => {
    const fake = fakeClient(withIssue({ on: false }));
    expect(await resolve(fake.client)).toMatchObject({
      kind: "unit",
      unitId: "u2"
    });
    expect(fake.calls.map((call) => call.table)).not.toContain(
      "unitQualityHold"
    );
    expect(await resolve(fakeClient(tables(true)).client)).toMatchObject({
      kind: "unit",
      unitId: "u2"
    });
  });

  it("releases the unit when its issue is closed", async () => {
    expect(
      await resolve(fakeClient(withIssue({ status: "Closed" })).client)
    ).toMatchObject({ kind: "unit", unitId: "u2" });
  });

  it("takes the one unit not on hold when none is named", async () => {
    expect(
      await resolve(fakeClient(withIssue({ unitId: "u1" })).client, {
        requestedUnitId: null
      })
    ).toMatchObject({ kind: "unit", unitId: "u2", via: "sole" });
  });

  it("reads no holds for a write that may name a unit on hold", async () => {
    const fake = fakeClient(withIssue());
    expect(await resolve(fake.client, { mode: "member" })).toMatchObject({
      kind: "unit",
      unitId: "u2"
    });
    expect(fake.calls.map((call) => call.table)).not.toContain(
      "companySettings"
    );
  });

  it("refuses when the holds cannot be read", async () => {
    const fake = fakeClient(withIssue());
    const failing = {
      from: (table: string) =>
        table === "companySettings"
          ? {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: null,
                    error: { message: "down" }
                  })
                })
              })
            }
          : (fake.client as { from: (table: string) => unknown }).from(table)
    };
    expect(await resolve(failing as never)).toEqual({
      kind: "refuse",
      pickUnit: false,
      message: expect.any(String)
    });
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
      "jobOperationTrackedEntity",
      "companySettings"
    ]);
    for (const call of fake.calls) {
      // The settings row is the company's: its id is the company id.
      expect(call.filters).toContainEqual(
        call.table === "companySettings" ? ["id", "co"] : ["companyId", "co"]
      );
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
