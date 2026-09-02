import { describe, expect, it } from "vitest";
import { getReadableIdWithRevision } from "~/utils/string";
import { solidWorksLookupValidator, solidWorksSendPayloadValidator } from "./integrations.solidworks.models";

describe("solidWorksSendPayloadValidator", () => {
  const validRoot = {
    partNumber: "ASM-100",
    name: "Main assembly",
    description: "Top level",
    revision: "B",
    configuration: "Default",
    sourcePath: "C:\\vault\\ASM-100.SLDASM"
  };

  it("accepts a vertical-slice payload with no BOM rows", () => {
    const parsed = solidWorksSendPayloadValidator.parse({
      root: validRoot
    });
    expect(parsed.rows).toEqual([]);
    expect(parsed.root.partNumber).toBe("ASM-100");
  });

  it("rejects a missing part number", () => {
    const parsed = solidWorksSendPayloadValidator.safeParse({
      root: { ...validRoot, partNumber: "" }
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a missing revision", () => {
    const parsed = solidWorksSendPayloadValidator.safeParse({
      root: { ...validRoot, revision: "" }
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts Onshape-shaped BOM rows", () => {
    const parsed = solidWorksSendPayloadValidator.parse({
      root: validRoot,
      rows: [
        {
          index: "1",
          readableId: "PRT-001",
          revision: "A",
          name: "Bracket",
          quantity: 2,
          replenishmentSystem: "Buy",
          defaultMethodType: "Purchase to Order",
          data: { configuration: "Default" }
        },
        {
          index: "1.1",
          readableId: "PRT-002",
          revision: "0",
          name: "Fastener",
          quantity: 4,
          replenishmentSystem: "Buy",
          defaultMethodType: "Pull from Inventory",
          data: {}
        }
      ]
    });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.index).toBe("1");
  });

  it("rejects a BOM row with a non-numeric quantity", () => {
    const parsed = solidWorksSendPayloadValidator.safeParse({
      root: validRoot,
      rows: [
        {
          index: "1",
          name: "Bracket",
          quantity: "two",
          replenishmentSystem: "Buy",
          defaultMethodType: "Purchase to Order",
          data: {}
        }
      ]
    });
    expect(parsed.success).toBe(false);
  });
});

describe("SolidWorks matching uses Carbon readableIdWithRevision", () => {
  it("matches Onshape releaseKey: revision A suffixes with a dot", () => {
    expect(getReadableIdWithRevision("PRT-002033", "A")).toBe("PRT-002033.A");
  });

  it("omits Carbon's default revision 0", () => {
    expect(getReadableIdWithRevision("PRT-002033", "0")).toBe("PRT-002033");
  });
});

describe("solidWorksLookupValidator", () => {
  it("accepts a batch of part numbers to look up", () => {
    const parsed = solidWorksLookupValidator.parse({
      items: [
        { readableId: "ASM-100", revision: "B" },
        { readableId: "PRT-001", revision: null }
      ]
    });
    expect(parsed.items).toHaveLength(2);
  });

  it("rejects an empty lookup batch", () => {
    const parsed = solidWorksLookupValidator.safeParse({ items: [] });
    expect(parsed.success).toBe(false);
  });
});
