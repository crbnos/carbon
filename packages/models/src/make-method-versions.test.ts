// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { explore } from "./explore";
import {
  makeMethodVersionsModel,
  type Operation,
  operationName,
  type Protocol,
  SHIPPED,
  type Status,
  VERSIONS,
  type Version
} from "./make-method-versions";

const BEFORE_IMPORT_ORDER = { ...SHIPPED, importLocksAllVersions: false };
const BEFORE_NEW_VERSION_CHECK = {
  ...BEFORE_IMPORT_ORDER,
  newVersionChecksActive: false
};
const BEFORE_SYNC_LOCK = {
  ...BEFORE_NEW_VERSION_CHECK,
  syncReadsStatusUnderLock: false
};
/** The protocol before 3a9da8dfd0: d8e790657d's import, nothing else locked. */
const BEFORE_ACTIVATION_LOCK = {
  ...BEFORE_SYNC_LOCK,
  activationLocksVersions: false
};
const BEFORE_D8E79065 = {
  ...BEFORE_ACTIVATION_LOCK,
  importReadsStatusUnderLock: false
};

const draft = { v1: "Draft", v2: "Draft", v3: "Draft" } as const;

describe("make method versions", () => {
  it("before d8e790657d, an import that read a Draft writes into it after an activation made it Active", () => {
    const run = (protocol: Protocol) =>
      explore(
        makeMethodVersionsModel(
          { v1: "Active", v2: "Draft", v3: "Draft" },
          [
            { kind: "import", versions: ["v2"] },
            { kind: "activate", version: "v2" }
          ],
          protocol
        )
      );

    const before = run(BEFORE_D8E79065);
    expect(before.ok).toBe(false);
    if (before.ok) return;
    expect(before.violation.invariant).toBe(
      "a BOM write commits only into a Draft"
    );
    expect(run(BEFORE_ACTIVATION_LOCK).ok).toBe(true);
  });

  it("before 3a9da8dfd0, two activations of two versions at once leave both Active", () => {
    const result = explore(
      makeMethodVersionsModel(
        { v1: "Active", v2: "Draft", v3: "Draft" },
        [
          { kind: "activate", version: "v2" },
          { kind: "activate", version: "v3" }
        ],
        BEFORE_ACTIVATION_LOCK
      )
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      invariant: "at most one version is Active",
      state: { status: { v1: "Archived", v2: "Active", v3: "Active" } }
    });
  });

  it("before 0f8e87b30b, an Onshape sync rewrites the BOM of a Draft activated while it ran", () => {
    const result = explore(
      makeMethodVersionsModel(
        draft,
        [
          { kind: "sync", version: "v1" },
          { kind: "activate", version: "v1" }
        ],
        BEFORE_SYNC_LOCK
      )
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      invariant: "a BOM write commits only into a Draft",
      trace: [
        "sync(v1)#1: read the make method's status",
        "sync(v1)#1: delete and insert the version's BOM lines",
        "activate(v1)#2: lock every version in id order: v1",
        "activate(v1)#2: lock every version in id order: v2",
        "activate(v1)#2: lock every version in id order: v3",
        "activate(v1)#2: archive the other versions still Active",
        "activate(v1)#2: set the version Active",
        "activate(v1)#2: commit",
        "sync(v1)#1: commit"
      ]
    });
  });

  it("before 9e77d7a7c3, a new version sets its Draft source Active beside the Active version", () => {
    const result = explore(
      makeMethodVersionsModel(
        { v1: "Draft", v2: "Active", v3: "Draft" },
        [{ kind: "newVersion", version: "v1" }],
        BEFORE_NEW_VERSION_CHECK
      )
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      invariant: "at most one version is Active",
      state: { status: { v1: "Active", v2: "Active" } }
    });
  });

  it("before 23f2206ff3, an import into v3 then v2 deadlocks with an activation that holds v2", () => {
    const result = explore(
      makeMethodVersionsModel(
        draft,
        [
          { kind: "import", versions: ["v3", "v2"] },
          { kind: "activate", version: "v1" }
        ],
        BEFORE_IMPORT_ORDER
      )
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.invariant).toBe("no deadlock");
    expect(result.violation.state.locks).toEqual({
      v1: "activate(v1)#2",
      v2: "activate(v1)#2",
      v3: "import(v3,v2)#1"
    });
  });

  it("the shipped protocol keeps every invariant for every start and any three writers", () => {
    expect(everyRun(SHIPPED)).toEqual({ runs: 11180, failures: [] });
  });

  it("the same search fails the protocol before 3a9da8dfd0", () => {
    expect(
      everyRun(BEFORE_ACTIVATION_LOCK, { stopAtFirst: true }).failures
    ).toHaveLength(1);
  });
});

const OPERATIONS: Operation[] = [
  ...VERSIONS.map((version) => ({ kind: "activate" as const, version })),
  ...VERSIONS.map((version) => ({
    kind: "import" as const,
    versions: [version]
  })),
  { kind: "import", versions: ["v3", "v2"] },
  ...VERSIONS.map((version) => ({ kind: "sync" as const, version })),
  ...VERSIONS.map((version) => ({ kind: "newVersion" as const, version }))
];

/** Every assignment of statuses with at most one Active version. */
function starts(): Record<Version, Status>[] {
  const statuses: Status[] = ["Draft", "Active", "Archived"];
  const out: Record<Version, Status>[] = [];
  for (const v1 of statuses) {
    for (const v2 of statuses) {
      for (const v3 of statuses) {
        const start = { v1, v2, v3 };
        if (Object.values(start).filter((s) => s === "Active").length <= 1) {
          out.push(start);
        }
      }
    }
  }
  return out;
}

/** Every multiset of up to three operations, from every start. */
function everyRun(protocol: Protocol, { stopAtFirst = false } = {}) {
  const sets: Operation[][] = [];
  const grow = (prefix: Operation[], from: number) => {
    if (prefix.length > 0) sets.push(prefix);
    if (prefix.length === 3) return;
    for (let i = from; i < OPERATIONS.length; i++) {
      grow([...prefix, OPERATIONS[i]!], i);
    }
  };
  grow([], 0);

  let runs = 0;
  const failures: string[] = [];
  for (const start of starts()) {
    for (const operations of sets) {
      runs++;
      const result = explore(
        makeMethodVersionsModel(start, operations, protocol)
      );
      if (!result.ok) {
        failures.push(
          `${JSON.stringify(start)} ${operations.map(operationName).join(",")}: ${result.violation.invariant}\n  ${result.violation.trace.join("\n  ")}`
        );
        if (stopAtFirst) return { runs, failures };
      }
    }
  }
  return { runs, failures };
}
