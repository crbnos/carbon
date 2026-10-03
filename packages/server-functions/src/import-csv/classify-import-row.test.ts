// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { classifyImportRow } from "./classify-import-row";

const base = () => ({
  externalIdMap: new Map<string, string>(),
  nameMap: new Map<string, string>(),
  seenIds: new Set<string>(),
  seenNames: new Set<string>()
});

it("skips a row whose name is blank", () => {
  expect(classifyImportRow({ ...base(), id: "X", name: "   " })).toEqual({
    action: "skip",
    reason: "Missing required Name",
    category: "error"
  });
});

it("blank-id rows each insert independently (no collapse on empty id)", () => {
  const ctx = base();
  const d1 = classifyImportRow({ ...ctx, id: "", name: "Acme" });
  expect(d1).toEqual({ action: "insert" });
  ctx.seenNames.add("Acme");
  const d2 = classifyImportRow({ ...ctx, id: "", name: "Globex" });
  expect(d2).toEqual({ action: "insert" });
});

it("updates when the id matches an existing external id", () => {
  expect(
    classifyImportRow({
      ...base(),
      id: "SUP-1",
      name: "Acme",
      externalIdMap: new Map([["SUP-1", "uuid-1"]])
    })
  ).toEqual({ action: "update", entityId: "uuid-1" });
});

it("updates when only the name matches an existing record", () => {
  expect(
    classifyImportRow({
      ...base(),
      id: "",
      name: "Acme",
      nameMap: new Map([["Acme", "uuid-2"]])
    })
  ).toEqual({ action: "update", entityId: "uuid-2" });
});

it("skips a duplicate non-empty id within the file", () => {
  expect(
    classifyImportRow({
      ...base(),
      id: "SUP-1",
      name: "Acme 2",
      seenIds: new Set(["SUP-1"])
    })
  ).toEqual({
    action: "skip",
    reason: 'Duplicate ID "SUP-1" in file',
    category: "skipped"
  });
});

it("skips a duplicate name within the file", () => {
  expect(
    classifyImportRow({
      ...base(),
      id: "",
      name: "Acme",
      seenNames: new Set(["Acme"])
    })
  ).toEqual({
    action: "skip",
    reason: 'Duplicate name "Acme" in file',
    category: "skipped"
  });
});

it("skips a repeated non-empty id once the caller has recorded it", () => {
  const ctx = base();
  const d1 = classifyImportRow({ ...ctx, id: "SUP-1", name: "Acme" });
  expect(d1).toEqual({ action: "insert" });
  ctx.seenIds.add("SUP-1");
  ctx.seenNames.add("Acme");
  const d2 = classifyImportRow({ ...ctx, id: "SUP-1", name: "Acme 2" });
  expect(d2).toEqual({
    action: "skip",
    reason: 'Duplicate ID "SUP-1" in file',
    category: "skipped"
  });
});

it("falls back to name match when a non-empty id has no id match", () => {
  expect(
    classifyImportRow({
      ...base(),
      id: "SUP-NEW",
      name: "Acme",
      nameMap: new Map([["Acme", "uuid-3"]])
    })
  ).toEqual({ action: "update", entityId: "uuid-3" });
});
