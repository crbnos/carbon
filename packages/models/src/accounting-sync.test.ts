// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  accountingSyncModel,
  type Kind,
  OPERATIONS,
  type Operation,
  type Protocol,
  type Provider,
  SHIPPED
} from "./accounting-sync";
import { explore } from "./explore";

const BEFORE_93C97ECA = { ...SHIPPED, editableKeyByContent: false };
const BEFORE_61638A58 = { ...BEFORE_93C97ECA, recordSummaryPush: false };
const BEFORE_7A874544 = { ...BEFORE_61638A58, versionedLink: false };
const BEFORE_516F2146 = {
  ...BEFORE_7A874544,
  createKey: false,
  lookupBeforeCreate: false
};
const BEFORE_DAC4D0F7 = { ...BEFORE_516F2146, fencedClose: false };

function only(
  invariant: string,
  model: ReturnType<typeof accountingSyncModel>
) {
  return explore({
    ...model,
    invariants: { [invariant]: model.invariants[invariant]! }
  });
}

describe("accounting sync", () => {
  it("before 516f214690, a journal whose create response was lost is created again by the Retry", () => {
    for (const provider of ["xero", "qbo"] as const) {
      const result = explore(
        accountingSyncModel(
          "document",
          provider,
          ["drainLost", "retry", "drain"],
          BEFORE_516F2146
        )
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.violation.invariant).toBe(
        "each Carbon record has at most one remote document"
      );
    }
  });

  it("a Xero create key alone does not cover a stale reclaim: the key is gone ten minutes later", () => {
    const result = explore(
      accountingSyncModel("document", "xero", ["drainDies", "reclaim"], {
        ...SHIPPED,
        lookupBeforeCreate: false
      })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      invariant: "each Carbon record has at most one remote document",
      trace: [
        "drainDies#1: claim the Pending operation",
        "drainDies#1: read the record and its mapping",
        "drainDies#1: create or update the remote document",
        "reclaim#2: ten minutes pass",
        "reclaim#2: claim the Pending or stale In Flight operation",
        "reclaim#2: read the record and its mapping",
        "reclaim#2: create or update the remote document"
      ]
    });
  });

  it("before dac4d0f75f, a reclaimed attempt's late close overwrites the newer attempt's", () => {
    const result = only(
      "a closed operation reflects the newest attempt",
      accountingSyncModel(
        "document",
        "xero",
        ["drain", "reclaim"],
        BEFORE_DAC4D0F7
      )
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.state).toMatchObject({
      attemptCount: 2,
      closedBy: 1
    });
  });

  it("before 7a87454474, an edit made while a customer's push is in flight is marked synced", () => {
    const result = explore(
      accountingSyncModel(
        "master",
        "xero",
        ["drain", "edit", "sweep"],
        BEFORE_7A874544
      )
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      invariant: "the mapping's synced version never hides an unpushed edit",
      trace: [
        "drain#1: claim the Pending operation",
        "drain#1: read the record and its mapping",
        "drain#1: look the counterpart up by name",
        "drain#1: create or update the remote document",
        "edit#2: a person edits the record",
        "drain#1: link the mapping"
      ]
    });
  });

  it("before 93c97eca28, a keyed create of an editable record answers a renamed retry with the old record, linked as the edit", () => {
    const renamedRetry = (protocol: Protocol) =>
      accountingSyncModel(
        "master",
        "qbo",
        ["drainLost", "rename", "sweep"],
        protocol
      );

    expect(
      only(
        "the mapping's synced version never hides an unpushed edit",
        renamedRetry(BEFORE_93C97ECA)
      ).ok
    ).toBe(false);
    expect(
      only(
        "the mapping's synced version never hides an unpushed edit",
        renamedRetry(SHIPPED)
      ).ok
    ).toBe(true);
    // Still open: the rename defeats the name lookup, so the retry makes a
    // second customer, as it did before creates had a key.
    expect(explore(renamedRetry(SHIPPED))).toMatchObject({
      ok: false,
      violation: {
        invariant: "each Carbon record has at most one remote document"
      }
    });
  });

  it("before 61638a586c, a consolidation that died after its create pushes a second summary the next day", () => {
    const result = explore(
      accountingSyncModel(
        "summary",
        "xero",
        ["consolidateDies", "nextDay"],
        BEFORE_61638A58
      )
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.invariant).toBe(
      "each Carbon record has at most one remote document"
    );
  });

  it("the shipped protocol keeps every invariant for every sequence of up to three operations", () => {
    expect(everyRun(SHIPPED)).toEqual({ runs: 865, failures: [] });
  });

  it("the same search fails the protocol before 61638a586c", () => {
    expect(everyRun(BEFORE_61638A58).failures.length).toBeGreaterThan(0);
  });
});

function everyRun(protocol: Protocol) {
  const configurations: Array<[Kind, Provider]> = [
    ["document", "xero"],
    ["document", "qbo"],
    ["master", "xero"],
    ["master", "qbo"],
    ["summary", "xero"]
  ];
  let runs = 0;
  const failures: string[] = [];
  for (const [kind, provider] of configurations) {
    const sequences: Operation[][] = [];
    const grow = (prefix: Operation[]) => {
      if (prefix.length > 0) sequences.push(prefix);
      if (prefix.length === 3) return;
      for (const op of OPERATIONS[kind]) grow([...prefix, op]);
    };
    grow([]);
    for (const operations of sequences) {
      runs++;
      const result = explore(
        accountingSyncModel(kind, provider, operations, protocol)
      );
      if (!result.ok) {
        failures.push(
          `${kind}/${provider} ${operations.join(",")}: ${result.violation.invariant}\n  ${result.violation.trace.join("\n  ")}`
        );
      }
    }
  }
  return { runs, failures };
}
