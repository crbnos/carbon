import { describe, expect, it } from "vitest";
import {
  buildAssemblyLineStatuses,
  buildPartStatuses,
  externalIdForAssembly,
  externalIdForBomLine,
  externalIdForPart,
  normalizeConfiguration
} from "./status";

const item = (id: string, readableId: string) => ({
  id,
  readableId,
  revision: "0",
  name: readableId
});

describe("buildPartStatuses", () => {
  const documentId = "d1";
  const elementId = "e1";

  it("prefers a mapping over a part-number match and reports the rest", () => {
    const statuses = buildPartStatuses({
      documentId,
      elementId,
      parts: [
        { partId: "p1", name: "Foot pad", partNumber: "WB-101", revision: "A" },
        {
          partId: "p2",
          name: "Leg tube",
          partNumber: "WB-102",
          revision: null
        },
        { partId: "p3", name: "Stringer", partNumber: null, revision: null }
      ],
      mappings: [
        {
          entityId: "item-1",
          externalId: externalIdForPart(documentId, elementId, "p1"),
          lastSyncedAt: "2026-08-28T00:00:00Z"
        }
      ],
      items: [item("item-1", "OTHER-NUMBER"), item("item-2", "WB-102")]
    });

    expect(statuses.map((s) => s.state)).toEqual([
      "linked",
      "matched",
      "missing"
    ]);
    expect(statuses[0]?.item?.id).toBe("item-1");
    expect(statuses[0]?.lastSyncedAt).toBe("2026-08-28T00:00:00Z");
    expect(statuses[1]?.item?.id).toBe("item-2");
    expect(statuses[2]?.item).toBeNull();
  });

  it("treats a mapping whose item is gone as not linked", () => {
    const statuses = buildPartStatuses({
      documentId,
      elementId,
      parts: [
        { partId: "p1", name: "Foot pad", partNumber: "WB-101", revision: "A" }
      ],
      mappings: [
        {
          entityId: "deleted-item",
          externalId: externalIdForPart(documentId, elementId, "p1"),
          lastSyncedAt: null
        }
      ],
      items: [item("item-9", "WB-101")]
    });

    expect(statuses[0]?.state).toBe("matched");
    expect(statuses[0]?.item?.id).toBe("item-9");
  });

  it("skips hidden parts and mappings from other elements", () => {
    const statuses = buildPartStatuses({
      documentId,
      elementId,
      parts: [
        {
          partId: "p1",
          name: "Ghost",
          partNumber: null,
          revision: null,
          isHidden: true
        },
        { partId: "p2", name: "Real", partNumber: null, revision: null }
      ],
      mappings: [
        {
          entityId: "item-1",
          externalId: externalIdForPart(documentId, "other-element", "p2"),
          lastSyncedAt: null
        }
      ],
      items: []
    });

    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.state).toBe("missing");
  });
});

const line = (
  index: string,
  partNumber: string | null,
  itemSource: {
    documentId?: string;
    elementId?: string;
    partId?: string;
  } | null
) => ({
  index,
  level: 1,
  partNumber,
  name: partNumber,
  quantity: 1,
  purchased: false,
  itemSource
});

describe("buildAssemblyLineStatuses", () => {
  it("links a line through its source part studio, not the assembly element", () => {
    // The assembly being viewed is "asm-el"; the part lives in "ps-el".
    const statuses = buildAssemblyLineStatuses({
      lines: [
        line("1", "WB-101", {
          documentId: "d1",
          elementId: "ps-el",
          partId: "p1"
        })
      ],
      mappings: [
        {
          entityId: "item-1",
          externalId: externalIdForPart("d1", "ps-el", "p1"),
          lastSyncedAt: "2026-08-28T00:00:00Z"
        }
      ],
      items: [item("item-1", "WB-101")]
    });

    expect(statuses[0]?.state).toBe("linked");
    expect(statuses[0]?.itemId).toBe("item-1");
    expect(statuses[0]?.lastSyncedAt).toBe("2026-08-28T00:00:00Z");
  });

  it("links across documents when the part was inserted from another one", () => {
    const statuses = buildAssemblyLineStatuses({
      lines: [
        line("1", "HDW-010", {
          documentId: "d2",
          elementId: "ps-el",
          partId: "JHD"
        })
      ],
      mappings: [
        {
          entityId: "item-1",
          externalId: externalIdForPart("d2", "ps-el", "JHD"),
          lastSyncedAt: null
        }
      ],
      items: [item("item-1", "HDW-010")]
    });

    expect(statuses[0]?.state).toBe("linked");
  });

  it("falls back to the part-number match when the row names no source", () => {
    const statuses = buildAssemblyLineStatuses({
      lines: [line("1", "WB-101", null), line("2", "WB-999", null)],
      mappings: [],
      items: [item("item-1", "WB-101")]
    });

    expect(statuses.map((s) => s.state)).toEqual(["matched", "missing"]);
    expect(statuses[0]?.itemId).toBe("item-1");
  });

  it("does not link through a mapping whose item is gone", () => {
    const statuses = buildAssemblyLineStatuses({
      lines: [
        line("1", "WB-101", {
          documentId: "d1",
          elementId: "ps-el",
          partId: "p1"
        })
      ],
      mappings: [
        {
          entityId: "deleted-item",
          externalId: externalIdForPart("d1", "ps-el", "p1"),
          lastSyncedAt: "2026-08-28T00:00:00Z"
        }
      ],
      items: [item("item-1", "WB-101")]
    });

    expect(statuses[0]?.state).toBe("matched");
    expect(statuses[0]?.itemId).toBe("item-1");
  });

  it("ignores a partial itemSource", () => {
    expect(externalIdForBomLine({ documentId: "d1" })).toBeNull();
    expect(externalIdForBomLine(null)).toBeNull();
    expect(
      externalIdForBomLine({
        documentId: "d1",
        elementId: "e1",
        partId: "p1"
      })
    ).toBe(externalIdForPart("d1", "e1", "p1"));
  });
});

describe("externalIdForBomLine", () => {
  it("keys a sub-assembly row the way that assembly's own push keys it", () => {
    // No partId: the row is a sub-assembly, so one mapping serves both the
    // parent's BOM line and the sub-assembly's own panel.
    expect(
      externalIdForBomLine({ documentId: "d1", elementId: "sub-el" })
    ).toBe(externalIdForAssembly("d1", "sub-el"));
  });
});

describe("configurations in identity", () => {
  it("reads the default configuration as no configuration, however it arrives", () => {
    for (const value of [null, undefined, "", "  ", "default", "Default"]) {
      expect(normalizeConfiguration(value)).toBeNull();
    }
  });

  it("decodes a configuration passed URL-encoded", () => {
    expect(normalizeConfiguration("List_abc%3DLarge")).toBe("List_abc=Large");
    expect(normalizeConfiguration("List_abc=Large")).toBe("List_abc=Large");
  });

  it("keeps the default key unchanged, so links written before still match", () => {
    expect(externalIdForPart("d", "e", "p", "default")).toBe("d:e:p");
    expect(externalIdForAssembly("d", "e", null)).toBe("d:e:assembly");
  });

  it("gives each configuration of one part its own key", () => {
    const large = externalIdForBomLine({
      documentId: "d",
      elementId: "e",
      partId: "RvED",
      configuration: "List_abc=Large"
    });
    const standard = externalIdForBomLine({
      documentId: "d",
      elementId: "e",
      partId: "RvED",
      configuration: "default"
    });
    expect(large).toBe("d:e:RvED:List_abc=Large");
    expect(standard).toBe("d:e:RvED");
    expect(large).not.toBe(standard);
  });

  it("links two configurations of one part to their own items", () => {
    const statuses = buildAssemblyLineStatuses({
      lines: [
        {
          index: "1",
          level: 1,
          partNumber: "DOOR-L",
          name: "Door",
          quantity: 1,
          purchased: false,
          itemSource: {
            documentId: "d",
            elementId: "e",
            partId: "RvED",
            configuration: "List_abc=Large"
          }
        },
        {
          index: "2",
          level: 1,
          partNumber: "DOOR-D",
          name: "Door",
          quantity: 1,
          purchased: false,
          itemSource: {
            documentId: "d",
            elementId: "e",
            partId: "RvED",
            configuration: "default"
          }
        }
      ],
      mappings: [
        {
          entityId: "large",
          externalId: "d:e:RvED:List_abc=Large",
          lastSyncedAt: null
        },
        { entityId: "default", externalId: "d:e:RvED", lastSyncedAt: null }
      ],
      items: [item("large", "DOOR-L"), item("default", "DOOR-D")]
    });
    expect(
      statuses.map((line) => [line.partNumber, line.state, line.itemId])
    ).toEqual([
      ["DOOR-L", "linked", "large"],
      ["DOOR-D", "linked", "default"]
    ]);
  });

  it("keys a Part Studio's parts by the configuration it is open in", () => {
    const [part] = buildPartStatuses({
      documentId: "d",
      elementId: "e",
      configuration: "List_abc=Large",
      parts: [
        {
          partId: "RvED",
          name: "Door",
          partNumber: "DOOR-L",
          isHidden: false
        } as never
      ],
      mappings: [
        { entityId: "default", externalId: "d:e:RvED", lastSyncedAt: null },
        {
          entityId: "large",
          externalId: "d:e:RvED:List_abc=Large",
          lastSyncedAt: null
        }
      ],
      items: [item("large", "DOOR-L"), item("default", "DOOR-D")]
    });
    expect(part?.state).toBe("linked");
    expect(part?.item?.id).toBe("large");
  });
});
