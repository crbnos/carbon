import { describe, expect, it } from "vitest";
import { createFixtureCatalog, walkPath } from "./catalog";
import {
  canAssign,
  describeType,
  literalValueMatchesType,
  operatorsForType,
  rendersAsText,
  t,
  typesEqual,
  valueTypeSchema
} from "./types";

/** The shape an integration step produces: an object, with an object inside it. */
const EVENT = t.record({
  summary: t.string,
  startDateTime: t.date,
  organizer: t.record({ email: t.string })
});

describe("record types", () => {
  describe("typesEqual", () => {
    // The bug this file exists for: the old `a.of.of === b.of.of` shorthand read
    // `undefined === undefined` for records, so ANY two record lists compared equal.
    it("distinguishes two record lists with different fields", () => {
      const events = t.list({ kind: "record", fields: { summary: t.string } });
      const people = t.list({ kind: "record", fields: { email: t.string } });
      expect(typesEqual(events, people)).toBe(false);
    });

    it("distinguishes records differing only in a nested field's type", () => {
      const a = t.record({ at: t.record({ on: t.date }) });
      const b = t.record({ at: t.record({ on: t.string }) });
      expect(typesEqual(a, b)).toBe(false);
    });

    it("distinguishes a subset from a superset", () => {
      const few = t.record({ summary: t.string });
      const many = t.record({ summary: t.string, extra: t.string });
      expect(typesEqual(few, many)).toBe(false);
      expect(typesEqual(many, few)).toBe(false);
    });

    it("ignores field order", () => {
      const a = t.record({ summary: t.string, at: t.date });
      const b = t.record({ at: t.date, summary: t.string });
      expect(typesEqual(a, b)).toBe(true);
    });

    // Same key count, same key names, one type different — the case a length-only
    // or key-name-only comparison would wave through.
    it("compares field types, not just field names", () => {
      const a = t.record({ id: t.string, count: t.number });
      const b = t.record({ id: t.string, count: t.string });
      expect(typesEqual(a, b)).toBe(false);
    });

    it("does not confuse a record with an entity of the same shape", () => {
      expect(typesEqual(t.record({ email: t.string }), t.entity("user"))).toBe(
        false
      );
    });
  });

  describe("assignability", () => {
    it("accepts an identical record and refuses a different one", () => {
      expect(canAssign(EVENT, EVENT)).toBe(true);
      expect(canAssign(EVENT, t.record({ summary: t.string }))).toBe(false);
    });

    // Batching lets a list fill a scalar slot; a record IS a scalar, so a list of
    // them must still satisfy that relaxation.
    it("lets a list of records fill a single record input when batching", () => {
      const list = t.list({ kind: "record", fields: { summary: t.string } });
      const one = t.record({ summary: t.string });
      expect(canAssign(list, one, { batching: true })).toBe(true);
      expect(canAssign(list, one)).toBe(false);
    });
  });

  describe("records are not literals, text, or comparable", () => {
    it("refuses a record literal even when the value looks right", () => {
      expect(
        literalValueMatchesType(EVENT, { summary: "Standup", organizer: {} })
      ).toBe(false);
    });

    it("refuses a list-of-records literal", () => {
      const list = t.list({ kind: "record", fields: { summary: t.string } });
      expect(literalValueMatchesType(list, [{ summary: "Standup" }])).toBe(
        false
      );
    });

    // rendersAsText false is what keeps a record out of every template.
    it("has no reading inside a sentence", () => {
      expect(rendersAsText(EVENT)).toBe(false);
      expect(
        rendersAsText(t.list({ kind: "record", fields: { a: t.string } }))
      ).toBe(false);
    });

    // No operator means the builder offers no way to put one in a condition.
    it("offers no operators, including on a list of records", () => {
      expect(operatorsForType(EVENT)).toEqual([]);
      expect(
        operatorsForType(t.list({ kind: "record", fields: { a: t.string } }))
      ).toEqual([]);
    });

    it("still offers contains on a list of primitives", () => {
      expect(operatorsForType(t.list(t.string as never))).toContain("contains");
    });
  });

  describe("describeType", () => {
    it("names records without leaking 'undefined'", () => {
      expect(describeType(EVENT)).toBe("an object");
      expect(
        describeType(t.list({ kind: "record", fields: { a: t.string } }))
      ).toBe("a list of objects");
    });
  });

  describe("walkPath", () => {
    const catalog = createFixtureCatalog();

    it("descends into a nested record field", () => {
      expect(walkPath(EVENT, ["organizer", "email"], catalog)).toEqual(
        t.string
      );
    });

    it("returns undefined for a field the record does not declare", () => {
      expect(walkPath(EVENT, ["location"], catalog)).toBeUndefined();
      expect(walkPath(EVENT, ["organizer", "phone"], catalog)).toBeUndefined();
    });

    it("refuses to walk past a primitive field", () => {
      expect(walkPath(EVENT, ["summary", "anything"], catalog)).toBeUndefined();
    });
  });

  describe("schema", () => {
    it("parses a nested record and a list of records", () => {
      expect(valueTypeSchema.safeParse(EVENT).success).toBe(true);
      expect(valueTypeSchema.safeParse(t.list(EVENT as never)).success).toBe(
        true
      );
    });

    // The constraint that forces `flatten` to be a flag on pluck rather than a
    // standalone operation: a 2D list cannot exist as a value at all.
    it("still refuses a list of lists", () => {
      const nested = { kind: "list", of: { kind: "list", of: t.string } };
      expect(valueTypeSchema.safeParse(nested).success).toBe(false);
    });

    it("refuses a record whose field is not a value type", () => {
      const bad = { kind: "record", fields: { a: { kind: "bogus" } } };
      expect(valueTypeSchema.safeParse(bad).success).toBe(false);
    });
  });
});
