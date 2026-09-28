import { describe, expect, it } from "vitest";
import {
  decodeRampKeysetCursor,
  encodeRampKeysetCursor,
  nextRampKeysetCursor,
  rampKeysetFilter
} from "./ramp-sync-cursor";

describe("Ramp outbound keyset cursors", () => {
  it("reads legacy timestamp cursors inclusively so timestamp ties are replayed", () => {
    expect(decodeRampKeysetCursor("2026-09-11T12:00:00.000Z")).toEqual({
      updatedAt: "2026-09-11T12:00:00.000Z",
      id: null
    });
  });

  it("round-trips the timestamp and id as one atomic cursor value", () => {
    const cursor = {
      updatedAt: "2026-09-11T12:00:00.000Z",
      id: "po_abc"
    };
    expect(decodeRampKeysetCursor(encodeRampKeysetCursor(cursor))).toEqual(
      cursor
    );
  });

  it("uses an inclusive legacy filter, then a strict two-column keyset", () => {
    expect(
      rampKeysetFilter({
        updatedAt: "2026-09-11T12:00:00.000Z",
        id: null
      })
    ).toEqual({ operator: "gte", value: "2026-09-11T12:00:00.000Z" });
    expect(
      rampKeysetFilter({
        updatedAt: "2026-09-11T12:00:00.000Z",
        id: "po_b"
      })
    ).toEqual({
      operator: "or",
      value:
        "updatedAt.gt.2026-09-11T12:00:00.000Z,and(updatedAt.eq.2026-09-11T12:00:00.000Z,id.gt.po_b)"
    });
  });

  it("holds immediately before the first failed row", () => {
    const rows = [
      { id: "a", updatedAt: "2026-09-11T12:00:00.000Z" },
      { id: "b", updatedAt: "2026-09-11T12:00:00.000Z" },
      { id: "c", updatedAt: "2026-09-11T12:00:01.000Z" }
    ];
    expect(nextRampKeysetCursor(rows, new Set(["b"]))).toEqual({
      updatedAt: rows[0]!.updatedAt,
      id: "a"
    });
  });

  it("does not advance when the first row fails", () => {
    const rows = [
      { id: "a", updatedAt: "2026-09-11T12:00:00.000Z" },
      { id: "b", updatedAt: "2026-09-11T12:00:00.000Z" }
    ];
    expect(nextRampKeysetCursor(rows, new Set(["a"]))).toBeNull();
  });

  it("advances to the final row only when the whole fetched prefix succeeded", () => {
    const rows = [
      { id: "a", updatedAt: "2026-09-11T12:00:00.000Z" },
      { id: "b", updatedAt: "2026-09-11T12:00:00.000Z" }
    ];
    expect(nextRampKeysetCursor(rows, new Set())).toEqual({
      updatedAt: rows[1]!.updatedAt,
      id: "b"
    });
  });
});
