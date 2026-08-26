import type { ValueType } from "@carbon/workflows";
import { describe, expect, it } from "vitest";
import { choiceState, readChoices, writeChoices } from "./multiChoice";

const CHOICES = ["inApp", "email", "slack"] as const;
const TYPE: ValueType = {
  kind: "list",
  of: { kind: "primitive", of: "string" }
};

describe("readChoices", () => {
  it("reads the members of a literal list", () => {
    expect(
      readChoices(
        { kind: "literal", type: TYPE, value: ["inApp", "slack"] },
        CHOICES
      )
    ).toEqual(["inApp", "slack"]);
  });

  it("drops members that are no longer offered", () => {
    expect(
      readChoices(
        { kind: "literal", type: TYPE, value: ["email", "carrier-pigeon"] },
        CHOICES
      )
    ).toEqual(["email"]);
  });

  it("reads nothing from an absent or non-literal value", () => {
    expect(readChoices(undefined, CHOICES)).toEqual([]);
    expect(
      readChoices(
        { kind: "ref", nodeId: "n", output: "record", path: [] },
        CHOICES
      )
    ).toEqual([]);
    expect(
      readChoices({ kind: "literal", type: TYPE, value: "email" }, CHOICES)
    ).toEqual([]);
  });
});

describe("choiceState", () => {
  const OPTIONS = [
    { value: "inApp" },
    { value: "email", disabled: true },
    { value: "slack" }
  ];
  const stored = (...names: string[]) =>
    ({ kind: "literal", type: TYPE, value: names }) as const;

  it("ticks a locked choice on a node that stores nothing", () => {
    expect(choiceState(OPTIONS, undefined, ["inApp"])).toEqual({
      shown: ["inApp"],
      frozen: ["inApp", "email"]
    });
  });

  it("leaves an unavailable choice removable once it is stored", () => {
    // The seeded default puts email on a node whose company has no plan for it. Freezing
    // it there would leave the author looking at a channel they cannot clear.
    expect(choiceState(OPTIONS, stored("inApp", "email"), ["inApp"])).toEqual({
      shown: ["inApp", "email"],
      frozen: ["inApp"]
    });
  });

  it("shows the ticks in the order the choices are offered", () => {
    expect(choiceState(OPTIONS, stored("slack", "inApp")).shown).toEqual([
      "inApp",
      "slack"
    ]);
  });
});

describe("writeChoices", () => {
  it("stores the picks in the order they are offered", () => {
    expect(writeChoices(["slack", "inApp"], CHOICES, TYPE)).toEqual({
      kind: "literal",
      type: TYPE,
      value: ["inApp", "slack"]
    });
  });

  it("stores an emptied set as absent", () => {
    expect(writeChoices([], CHOICES, TYPE)).toBeUndefined();
  });

  it("ignores a pick that is not one of the choices", () => {
    expect(writeChoices(["email", "sms"], CHOICES, TYPE)).toEqual({
      kind: "literal",
      type: TYPE,
      value: ["email"]
    });
  });
});
