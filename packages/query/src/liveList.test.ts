// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  expiredStoredKeys,
  type LoggedChanges,
  oldestCursor,
  planSync,
  removeRows,
  STORED_LIST_MAX_AGE_MS,
  staleStoredKeys,
  storedAtKey,
  storedListKey,
  storedListKeys,
  upsertRows
} from "./liveList";

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);
const rows = [
  { id: "1", name: "Acme" },
  { id: "2", name: "Zenith" }
];
const cursor = { xid: "100", epoch: "e1", at: "2026-10-05T00:00:00Z" };
const log = (
  changes: LoggedChanges["changes"],
  reset = false
): LoggedChanges => ({ ...cursor, reset, changes });

describe("upsertRows / removeRows", () => {
  it("adds a new row in sort order", () => {
    expect(upsertRows(rows, [{ id: "3", name: "Mid" }], byName)).toEqual([
      rows[0],
      { id: "3", name: "Mid" },
      rows[1]
    ]);
  });

  it("replaces a row it already has, without a duplicate", () => {
    expect(upsertRows(rows, [{ id: "1", name: "Zulu" }], byName)).toEqual([
      rows[1],
      { id: "1", name: "Zulu" }
    ]);
  });

  it("removes rows by id", () => {
    expect(removeRows(rows, ["2", "9"])).toEqual([rows[0]]);
  });
});

describe("oldestCursor", () => {
  it("is null when no list has a cursor", () => {
    expect(oldestCursor([null, null])).toBeNull();
  });

  it("picks the lowest transaction id, compared as a number", () => {
    const older = { ...cursor, xid: "99" };
    expect(oldestCursor([cursor, null, older])).toBe(older);
  });
});

describe("planSync", () => {
  it("re-reads only the changed rows of the list's tables", () => {
    expect(
      planSync(log({ customer: ["1"], supplier: ["7"] }), ["customer"], true)
    ).toEqual([["customer", ["1"]]]);
  });

  it("does nothing when none of the list's tables changed", () => {
    expect(planSync(log({ supplier: ["7"] }), ["customer"], true)).toEqual([]);
  });

  it("fetches everything when the log was reset", () => {
    expect(planSync(log({}, true), ["customer"], true)).toBe("all");
  });

  it("fetches everything when the answer does not cover this list", () => {
    expect(planSync(log({}), ["customer"], false)).toBe("all");
  });

  it("fetches everything when a table changed too much to list", () => {
    expect(planSync(log({ customer: null }), ["customer"], true)).toBe("all");
  });

  it("fetches everything past 500 changed rows", () => {
    const ids = Array.from({ length: 501 }, (_, i) => String(i));
    expect(planSync(log({ customer: ids }), ["customer"], true)).toBe("all");
  });
});

describe("staleStoredKeys", () => {
  const scope = {
    names: ["items", "customers"],
    userId: "u1",
    companyIds: ["c1", "c2"]
  };

  it("keeps the user's lists for the companies they belong to", () => {
    const keys = [
      storedListKey("c1", "u1", "items"),
      storedListKey("c2", "u1", "customers")
    ];
    expect(staleStoredKeys(keys, scope)).toEqual([]);
  });

  it("drops a company the user was removed from", () => {
    const gone = storedListKey("c3", "u1", "items");
    expect(
      staleStoredKeys([storedListKey("c1", "u1", "items"), gone], scope)
    ).toEqual([gone]);
  });

  it("drops another user's lists and copies stored before lists had an owner", () => {
    const other = storedListKey("c1", "u2", "items");
    expect(staleStoredKeys([other, "items:c1"], scope)).toEqual([
      other,
      "items:c1"
    ]);
  });

  it("leaves keys that are not a live list", () => {
    expect(staleStoredKeys(["search:c9:u9", "recent"], scope)).toEqual([]);
  });
});

describe("expiredStoredKeys", () => {
  const now = 1_800_000_000_000;

  it("keeps a list written within the last day", () => {
    expect(expiredStoredKeys([["items:c1:u1", now - 1000]], now)).toEqual([]);
    expect(
      expiredStoredKeys([["items:c1:u1", now - STORED_LIST_MAX_AGE_MS]], now)
    ).toEqual([]);
  });

  it("expires an older list, and one with no write time", () => {
    expect(
      expiredStoredKeys(
        [
          ["items:c1:u1", now - STORED_LIST_MAX_AGE_MS - 1],
          ["customers:c1:u1", null]
        ],
        now
      )
    ).toEqual(["items:c1:u1", "customers:c1:u1"]);
  });
});

describe("storedListKeys", () => {
  it("names the lists, not their write times or other keys", () => {
    const key = storedListKey("c1", "u1", "items");
    expect(
      storedListKeys(
        [key, storedAtKey(key), "search:c1:u1", "recent"],
        ["items"]
      )
    ).toEqual([key]);
  });
});
