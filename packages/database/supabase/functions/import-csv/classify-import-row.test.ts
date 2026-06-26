import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { classifyImportRow } from "./classify-import-row.ts";

const base = () => ({
  externalIdMap: new Map<string, string>(),
  nameMap: new Map<string, string>(),
  seenIds: new Set<string>(),
  seenNames: new Set<string>(),
});

Deno.test("skips a row whose name is blank", () => {
  assertEquals(
    classifyImportRow({ ...base(), id: "X", name: "   " }),
    { action: "skip", reason: "Missing required Name", category: "error" }
  );
});

Deno.test("blank-id rows each insert independently (no collapse on empty id)", () => {
  const ctx = base();
  const d1 = classifyImportRow({ ...ctx, id: "", name: "Acme" });
  assertEquals(d1, { action: "insert" });
  ctx.seenNames.add("Acme");
  const d2 = classifyImportRow({ ...ctx, id: "", name: "Globex" });
  assertEquals(d2, { action: "insert" });
});

Deno.test("updates when the id matches an existing external id", () => {
  assertEquals(
    classifyImportRow({
      ...base(),
      id: "SUP-1",
      name: "Acme",
      externalIdMap: new Map([["SUP-1", "uuid-1"]]),
    }),
    { action: "update", entityId: "uuid-1" }
  );
});

Deno.test("updates when only the name matches an existing record", () => {
  assertEquals(
    classifyImportRow({
      ...base(),
      id: "",
      name: "Acme",
      nameMap: new Map([["Acme", "uuid-2"]]),
    }),
    { action: "update", entityId: "uuid-2" }
  );
});

Deno.test("skips a duplicate non-empty id within the file", () => {
  assertEquals(
    classifyImportRow({
      ...base(),
      id: "SUP-1",
      name: "Acme 2",
      seenIds: new Set(["SUP-1"]),
    }),
    { action: "skip", reason: 'Duplicate ID "SUP-1" in file', category: "skipped" }
  );
});

Deno.test("skips a duplicate name within the file", () => {
  assertEquals(
    classifyImportRow({
      ...base(),
      id: "",
      name: "Acme",
      seenNames: new Set(["Acme"]),
    }),
    { action: "skip", reason: 'Duplicate name "Acme" in file', category: "skipped" }
  );
});

Deno.test("skips a repeated non-empty id once the caller has recorded it", () => {
  const ctx = base();
  const d1 = classifyImportRow({ ...ctx, id: "SUP-1", name: "Acme" });
  assertEquals(d1, { action: "insert" });
  ctx.seenIds.add("SUP-1");
  ctx.seenNames.add("Acme");
  const d2 = classifyImportRow({ ...ctx, id: "SUP-1", name: "Acme 2" });
  assertEquals(d2, { action: "skip", reason: 'Duplicate ID "SUP-1" in file', category: "skipped" });
});

Deno.test("falls back to name match when a non-empty id has no id match", () => {
  assertEquals(
    classifyImportRow({
      ...base(),
      id: "SUP-NEW",
      name: "Acme",
      nameMap: new Map([["Acme", "uuid-3"]]),
    }),
    { action: "update", entityId: "uuid-3" }
  );
});
