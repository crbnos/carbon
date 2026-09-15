import { describe, expect, it } from "vitest";
import { flattenBomTree, missingBomColumnsMessage, parseBomTree } from "./bom";

const H = [
  { id: "h-item", name: "Item" },
  { id: "h-pn", name: "Part number" },
  { id: "h-rev", name: "Revision" },
  { id: "h-name", name: "Name" },
  { id: "h-qty", name: "Quantity" },
  { id: "h-pl", name: "Purchasing Level" }
];

const row = (
  item: string,
  pn: string | null,
  qty: unknown,
  purchasing = "Made",
  extra: Record<string, unknown> = {}
) => ({
  headerIdToValue: {
    "h-item": item,
    "h-pn": pn,
    "h-rev": { displayName: "A" },
    "h-name": `Name ${item}`,
    "h-qty": qty,
    "h-pl": purchasing
  },
  ...extra
});

describe("parseBomTree", () => {
  it("builds the tree from dotted indexes and separates the root row", () => {
    const { root, lines } = parseBomTree({
      headers: H,
      rows: [
        row("0", "WB-100", 1),
        row("1.1", "LEG-003", 4),
        row("1", "SUB-001", 2),
        row("2", "TOP-001", 1, "Purchased")
      ]
    });

    expect(root?.partNumber).toBe("WB-100");
    expect(lines.map((l) => l.index)).toEqual(["1", "2"]);
    expect(lines[0]?.children.map((c) => c.partNumber)).toEqual(["LEG-003"]);
    expect(lines[0]?.quantity).toBe(2);
    expect(lines[1]?.purchased).toBe(true);
    expect(lines[0]?.revision).toBe("A");
  });

  it("defaults a missing or bad quantity to 1 and survives missing columns", () => {
    const { lines } = parseBomTree({
      headers: H,
      rows: [row("1", null, "not-a-number"), row("2", "X-1", null)]
    });
    expect(lines[0]?.quantity).toBe(1);
    expect(lines[0]?.partNumber).toBeNull();
    expect(lines[1]?.quantity).toBe(1);
  });

  it("keeps itemSource when present and flattens depth-first", () => {
    const { lines } = parseBomTree({
      headers: H,
      rows: [
        row("1", "A-1", 1, "Made", {
          itemSource: { documentId: "d1", elementId: "e1", partId: "p1" }
        }),
        row("1.1", "A-2", 3),
        row("2", "B-1", 1)
      ]
    });
    expect(lines[0]?.itemSource?.partId).toBe("p1");
    expect(flattenBomTree(lines).map((n) => n.index)).toEqual([
      "1",
      "1.1",
      "2"
    ]);
  });

  it("keeps the row's configuration, which a configured part's identity needs", () => {
    const { lines } = parseBomTree({
      headers: H,
      rows: [
        row("1", "A-1", 1, "Made", {
          itemSource: {
            documentId: "d1",
            elementId: "e1",
            partId: "p1",
            configuration: "List_abc=Large"
          }
        })
      ]
    });
    expect(lines[0]?.itemSource?.configuration).toBe("List_abc=Large");
  });

  it("tolerates an empty payload", () => {
    const { root, lines, missingColumns } = parseBomTree(null);
    expect(root).toBeNull();
    expect(lines).toEqual([]);
    expect(missingColumns).toEqual([]);
  });

  it("names a missing Item column instead of returning an empty tree as if valid", () => {
    // Without "Item" every row reads as the root; the lines come back empty.
    const { lines, missingColumns } = parseBomTree({
      headers: H.filter((header) => header.name !== "Item"),
      rows: [row("1", "A-1", 1), row("2", "B-1", 1)]
    });
    expect(lines).toEqual([]);
    expect(missingColumns).toEqual(["Item"]);
  });

  it("names every missing required column", () => {
    const { missingColumns } = parseBomTree({
      headers: H.filter(
        (header) => header.name !== "Item" && header.name !== "Part number"
      ),
      rows: [row("1", "A-1", 1)]
    });
    expect(missingColumns).toEqual(["Item", "Part number"]);
    expect(missingBomColumnsMessage(missingColumns)).toContain(
      '"Item" and "Part number"'
    );
  });

  it("does not flag the headers of a BOM with no rows", () => {
    expect(parseBomTree({ headers: [], rows: [] }).missingColumns).toEqual([]);
    expect(
      parseBomTree({ headers: H, rows: [row("1", "A-1", 1)] }).missingColumns
    ).toEqual([]);
  });
});
