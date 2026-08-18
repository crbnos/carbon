import { describe, expect, it } from "vitest";
import {
  buildOnshapeBomTree,
  type OnshapeBomResponse,
  parseOnshapeBom,
  resolveBomRow
} from "./bom";

// Fixture mirrors a REAL response captured from the RD-410 Wandleser RFID
// assembly at released version A: 8 rows, one subassembly with four children,
// seven of the eight parts living in ONE Part Studio element and distinguished
// only by partId. Header ids and the values below are the shapes Onshape
// actually returns, including partId "" (not null) for an assembly.

const H = {
  item: "h-item",
  qty: "h-qty",
  pn: "h-pn",
  desc: "h-desc",
  name: "h-name",
  rev: "h-rev",
  material: "h-material"
};

const PART_STUDIO = "6a9b122b051dc0b1243908a7";
const SUBASSEMBLY = "c6f22c1f2b0a9d3e4c5b6a70";
const DOC = "fd15a005d9711c2535b11835";
const VERSION = "05ba9d4e8ffbcbc9cee29003";

function row(
  item: string,
  indentLevel: number,
  partNumber: string,
  qty: number,
  elementId: string,
  partId: string,
  name: string
) {
  return {
    itemSource: {
      documentId: DOC,
      elementId,
      partId,
      configuration: "default",
      wvmId: VERSION,
      wvmType: "v"
    },
    indentLevel,
    rowId: `row-${partNumber}`,
    headerIdToValue: {
      [H.item]: item,
      [H.qty]: qty,
      [H.pn]: partNumber,
      [H.rev]: "A",
      [H.name]: name,
      [H.desc]: "",
      // Onshape returns some cells as objects carrying a displayName.
      [H.material]: { displayName: "ABS", id: "mat-abs" }
    }
  };
}

const RESPONSE: OnshapeBomResponse = {
  headers: [
    { id: H.item, name: "Item" },
    { id: H.qty, name: "Quantity" },
    { id: H.pn, name: "Part number" },
    { id: H.desc, name: "Description" },
    { id: H.name, name: "Name" },
    { id: H.rev, name: "Revision" },
    { id: H.material, name: "Material" }
  ],
  topLevelAssemblyRow: {
    itemSource: {
      documentId: DOC,
      elementId: "71d063cabedf14392964ab6d",
      partId: "",
      configuration: "default",
      wvmId: VERSION,
      wvmType: "v"
    },
    indentLevel: 0,
    rowId: "row-top",
    headerIdToValue: {
      // NOTE: the top-level row's "Item" is the assembly NAME, not a path.
      [H.item]: "RD-410 Wandleser RFID",
      [H.qty]: 1,
      [H.pn]: "RD-410",
      [H.rev]: "A",
      [H.name]: "RD-410 Wandleser RFID"
    }
  },
  rows: [
    row("1", 0, "EL-703", 1, PART_STUDIO, "JHD", "Gehäuse ABS IP54"),
    row("2", 0, "PK-410", 1, PART_STUDIO, "JID", "Verpackung Wandleser"),
    row("3", 0, "MC-101", 1, PART_STUDIO, "JND", "Kabelverschraubungsset"),
    row("4", 0, "SA-800", 1, SUBASSEMBLY, "", "SA-800 Leserkern-Baugruppe"),
    row("4.1", 1, "EL-702", 1, PART_STUDIO, "JJD", "Leseplatine RFID"),
    row("4.2", 1, "EL-402", 1, PART_STUDIO, "JKD", "NFC Reader IC"),
    row("4.3", 1, "EL-407", 1, PART_STUDIO, "JLD", "RFID Anpassnetzwerk"),
    row("4.4", 1, "EL-404", 2, PART_STUDIO, "JMD", "RGB Status-LED")
  ]
};

describe("parseOnshapeBom", () => {
  it("keeps the top-level assembly OUT of the row list", () => {
    const parsed = parseOnshapeBom(RESPONSE);
    expect(parsed.rows).toHaveLength(8);
    expect(parsed.rows.map((r) => r.partNumber)).not.toContain("RD-410");
    expect(parsed.topLevel?.partNumber).toBe("RD-410");
  });

  it("preserves each row's CAD identity", () => {
    const parsed = parseOnshapeBom(RESPONSE);
    const el703 = parsed.rows.find((r) => r.partNumber === "EL-703")!;
    expect(el703.documentId).toBe(DOC);
    expect(el703.elementId).toBe(PART_STUDIO);
    expect(el703.partId).toBe("JHD");
    expect(el703.configuration).toBe("default");
  });

  it("normalizes an assembly's empty partId to null", () => {
    const parsed = parseOnshapeBom(RESPONSE);
    const sub = parsed.rows.find((r) => r.partNumber === "SA-800")!;
    expect(sub.partId).toBeNull();
    // ...and the top-level assembly likewise.
    expect(parsed.topLevel?.partId).toBeNull();
  });

  it("distinguishes parts that share one Part Studio element", () => {
    const parsed = parseOnshapeBom(RESPONSE);
    const fromStudio = parsed.rows.filter((r) => r.elementId === PART_STUDIO);
    // Seven of eight rows come from ONE element — element alone is not identity.
    expect(fromStudio).toHaveLength(7);
    expect(new Set(fromStudio.map((r) => r.partId)).size).toBe(7);
  });

  it("reads quantity as a number, including quantities above one", () => {
    const parsed = parseOnshapeBom(RESPONSE);
    expect(parsed.rows.find((r) => r.partNumber === "EL-404")!.quantity).toBe(
      2
    );
    expect(parsed.rows.find((r) => r.partNumber === "EL-703")!.quantity).toBe(
      1
    );
  });

  it("unwraps object-valued cells via displayName", () => {
    const parsed = parseOnshapeBom(RESPONSE);
    expect(parsed.rows[0]!.columns.Material).toBe("ABS");
  });

  it("exposes every column by name for later custom-field mapping", () => {
    const parsed = parseOnshapeBom(RESPONSE);
    expect(Object.keys(parsed.rows[0]!.columns).sort()).toEqual([
      "Description",
      "Item",
      "Material",
      "Name",
      "Part number",
      "Quantity",
      "Revision"
    ]);
  });

  it("drops a row with no addressable CAD source rather than importing it", () => {
    const broken: OnshapeBomResponse = {
      headers: RESPONSE.headers,
      rows: [
        // no itemSource at all
        { indentLevel: 0, headerIdToValue: { [H.pn]: "ORPHAN" } },
        RESPONSE.rows![0]!
      ]
    };
    const parsed = parseOnshapeBom(broken);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.skipped).toBe(1);
    expect(parsed.rows[0]!.partNumber).toBe("EL-703");
  });

  it("survives an empty or malformed response", () => {
    expect(parseOnshapeBom({}).rows).toEqual([]);
    expect(parseOnshapeBom({} as OnshapeBomResponse).topLevel).toBeNull();
  });
});

describe("buildOnshapeBomTree", () => {
  it("nests children under the subassembly that owns them", () => {
    const parsed = parseOnshapeBom(RESPONSE);
    const tree = buildOnshapeBomTree(parsed.rows);

    expect(tree.map((n) => n.row.partNumber)).toEqual([
      "EL-703",
      "PK-410",
      "MC-101",
      "SA-800"
    ]);

    const sub = tree.find((n) => n.row.partNumber === "SA-800")!;
    expect(sub.children.map((c) => c.row.partNumber)).toEqual([
      "EL-702",
      "EL-402",
      "EL-407",
      "EL-404"
    ]);
    // The flat parts have no children.
    expect(tree[0]!.children).toEqual([]);
  });

  it("uses indentLevel rather than the dotted Item path", () => {
    // Same structure, but with Item strings that would mis-level if parsed:
    // Onshape's top-level row proves Item is not always a numeric path.
    const parsed = parseOnshapeBom({
      headers: RESPONSE.headers,
      rows: [
        row("A", 0, "PARENT", 1, SUBASSEMBLY, "", "Parent"),
        row("B", 1, "CHILD", 1, PART_STUDIO, "JHD", "Child")
      ]
    });
    const tree = buildOnshapeBomTree(parsed.rows);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.row.partNumber).toBe("CHILD");
  });

  it("handles a deeper nesting than the sample", () => {
    const parsed = parseOnshapeBom({
      headers: RESPONSE.headers,
      rows: [
        row("1", 0, "L0", 1, SUBASSEMBLY, "", "L0"),
        row("1.1", 1, "L1", 1, SUBASSEMBLY, "", "L1"),
        row("1.1.1", 2, "L2", 1, PART_STUDIO, "JHD", "L2"),
        row("2", 0, "SIBLING", 1, PART_STUDIO, "JID", "Sibling")
      ]
    });
    const tree = buildOnshapeBomTree(parsed.rows);
    expect(tree.map((n) => n.row.partNumber)).toEqual(["L0", "SIBLING"]);
    expect(tree[0]!.children[0]!.children[0]!.row.partNumber).toBe("L2");
  });
});

describe("resolveBomRow", () => {
  it("picks the candidate at the row's revision, not just any mapped one", () => {
    // The live failure this exists to prevent: a BOM line naming revision A
    // resolving to the item at revision C purely because C was mapped first.
    const result = resolveBomRow("A", [
      { itemId: "item_C", revision: "C" },
      { itemId: "item_A", revision: "A" }
    ]);
    expect(result).toEqual({ kind: "matched", itemId: "item_A" });
  });

  it("reports revision-missing rather than silently using a sibling", () => {
    const result = resolveBomRow("A", [{ itemId: "item_C", revision: "C" }]);
    expect(result).toEqual({
      kind: "revision-missing",
      siblingItemIds: ["item_C"]
    });
  });

  it("reports unmapped when Carbon has never seen the part", () => {
    expect(resolveBomRow("A", [])).toEqual({ kind: "unmapped" });
  });

  it("treats '', '0' and null as the same initial revision", () => {
    expect(resolveBomRow("", [{ itemId: "i", revision: "0" }])).toEqual({
      kind: "matched",
      itemId: "i"
    });
    expect(resolveBomRow("0", [{ itemId: "i", revision: null }])).toEqual({
      kind: "matched",
      itemId: "i"
    });
    expect(resolveBomRow("", [{ itemId: "i", revision: "" }])).toEqual({
      kind: "matched",
      itemId: "i"
    });
  });

  it("does not treat a named revision as the initial one", () => {
    expect(resolveBomRow("A", [{ itemId: "i", revision: "0" }]).kind).toBe(
      "revision-missing"
    );
  });

  it("flags two items claiming one part at the same revision", () => {
    const result = resolveBomRow("A", [
      { itemId: "x", revision: "A" },
      { itemId: "y", revision: "A" }
    ]);
    expect(result).toEqual({ kind: "ambiguous", itemIds: ["x", "y"] });
  });
});
