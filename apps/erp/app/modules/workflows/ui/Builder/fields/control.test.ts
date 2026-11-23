// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ValueType } from "@carbon/ee/workflows";
import { describe, expect, it } from "vitest";
import { asCalendarDateTime, isWritableList, pickControl } from "./control";

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

describe("asCalendarDateTime", () => {
  it("reads a stored instant on the company's calendar", () => {
    expect(asCalendarDateTime("2026-08-01T14:30:00Z", "UTC")?.toString()).toBe(
      "2026-08-01T14:30:00"
    );
  });

  it("reads a legacy bare date as midnight", () => {
    expect(asCalendarDateTime("2026-08-01", "UTC")?.toString()).toBe(
      "2026-08-01T00:00:00"
    );
  });

  it("leaves a near-miss empty rather than showing midnight", () => {
    expect(asCalendarDateTime("2026-08-01junk", "UTC")).toBeNull();
  });
});
