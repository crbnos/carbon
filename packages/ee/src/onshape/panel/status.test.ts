import { describe, expect, it } from "vitest";
import { buildPartStatuses, externalIdForPart } from "./status";

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
