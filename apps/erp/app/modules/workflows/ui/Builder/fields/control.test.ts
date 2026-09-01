import type { ValueType } from "@carbon/workflows";
import { describe, expect, it, vi } from "vitest";
import { isWritableList, pickControl } from "./control";

// `recordPickers` renders Lingui `msg` labels, which the test runner does not
// transform; the picker table is not what these cases are about.
vi.mock("./recordPickers", () => ({ hasRecordPicker: () => false }));

const STRING_LIST: ValueType = {
  kind: "list",
  of: { kind: "primitive", of: "string" }
};
const NUMBER_LIST: ValueType = {
  kind: "list",
  of: { kind: "primitive", of: "number" }
};
const ENTITY_LIST: ValueType = {
  kind: "list",
  of: { kind: "entity", of: "job" }
};

describe("isWritableList", () => {
  it("is a list of plain text and nothing else", () => {
    expect(isWritableList(STRING_LIST)).toBe(true);
    expect(isWritableList(NUMBER_LIST)).toBe(false);
    expect(isWritableList(ENTITY_LIST)).toBe(false);
    expect(isWritableList({ kind: "primitive", of: "string" })).toBe(false);
  });
});

describe("pickControl", () => {
  // Gmail's To/CC/BCC and a calendar's attendees: a person types the addresses.
  it("lets a list of plain text be written down", () => {
    expect(pickControl(STRING_LIST, undefined, undefined)).toBe("literal");
  });

  it("keeps a list of records or numbers variable-only", () => {
    expect(pickControl(ENTITY_LIST, undefined, undefined)).toBe("pick");
    expect(pickControl(NUMBER_LIST, undefined, undefined)).toBe("pick");
  });

  it("shows a bound variable as a chip whatever the list holds", () => {
    expect(
      pickControl(
        STRING_LIST,
        { kind: "ref", nodeId: "find", output: "emails", path: [] },
        undefined
      )
    ).toBe("chip");
  });

  it("still gives free text the inline editor", () => {
    expect(
      pickControl({ kind: "primitive", of: "string" }, undefined, undefined)
    ).toBe("inline");
  });
});
