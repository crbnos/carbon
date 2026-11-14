// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import type { OnshapeElementRow } from "./client";
import { settleBefore, workspaceSourceStates } from "./source-state";

const element = (
  id: string,
  elementType: string,
  microversionId?: string
): OnshapeElementRow => ({ id, name: id, elementType, microversionId });

// The Panel QA document as Onshape listed it on 2026-10-31.
const workspace = (over: Record<string, string> = {}) => [
  element("ps", "PARTSTUDIO", over.ps ?? "bc63"),
  element("drw", "APPLICATION", over.drw ?? "9e5b"),
  element("asm", "ASSEMBLY", over.asm ?? "5f7b"),
  element("bom", "BILLOFMATERIALS", over.bom ?? "9d48"),
  element("vars", "VARIABLESTUDIO", over.vars ?? "1a2b")
];

describe("workspaceSourceStates", () => {
  const states = (over: Record<string, string> = {}) =>
    workspaceSourceStates(workspace(over));

  it("stays the same when only a drawing or a BOM table changes", () => {
    expect(states({ drw: "0c75", bom: "403e" })).toEqual(states());
  });

  it("changes the assemblies state, not the parts state, when only an assembly changes", () => {
    const after = states({ asm: "3a22", bom: "ed15" });
    expect(after?.parts).toBe(states()?.parts);
    expect(after?.assemblies).not.toBe(states()?.assemblies);
  });

  it.each(["ps", "vars"])(
    "changes both states when the %s element changes",
    (id) => {
      const after = states({ [id]: "changed" });
      expect(after?.parts).not.toBe(states()?.parts);
      expect(after?.assemblies).not.toBe(states()?.assemblies);
    }
  );

  it("does not depend on the order Onshape lists the elements in", () => {
    expect(workspaceSourceStates([...workspace()].reverse())).toEqual(states());
  });

  it("is null when no part or assembly element carries a microversion", () => {
    expect(
      workspaceSourceStates([
        element("drw", "APPLICATION", "9e5b"),
        element("ps", "PARTSTUDIO")
      ])
    ).toBeNull();
  });
});

describe("settleBefore", () => {
  it("returns the value of a read that finishes before the deadline", async () => {
    expect(await settleBefore(Promise.resolve(7), Date.now() + 1000)).toEqual({
      settled: true,
      value: 7
    });
  });

  it("gives up on a read still running at the deadline", async () => {
    const never = new Promise<number>(() => undefined);
    expect(await settleBefore(never, Date.now() + 5)).toEqual({
      settled: false
    });
  });

  it("passes on a read that fails before the deadline", async () => {
    await expect(
      settleBefore(Promise.reject(new Error("402")), Date.now() + 1000)
    ).rejects.toThrow("402");
  });
});
