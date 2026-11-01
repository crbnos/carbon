// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LabelSize } from "@carbon/utils";
import { labelSizes } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import {
  canHoldKanbanLabel,
  generateKanbanLabelZPL,
  type KanbanLabelItem,
  wrapKanbanLabelText
} from "./KanbanLabelZPL";

const baseUrl = "https://app.carbon.ms";

const item: KanbanLabelItem = {
  id: "kb_0123456789abcdefghij",
  kanbanId: "KB000002",
  itemName: "M6 Socket Head Cap Screw",
  itemReadableId: "FAS-0006.A",
  locationName: "Plant",
  storageUnitName: "A-01-02",
  supplierName: "McMaster-Carr",
  quantity: 100,
  unitOfMeasureCode: "EA"
};

const size = (id: string): LabelSize => {
  const found = labelSizes.find((s) => s.id === id);
  if (!found) throw new Error(`Missing label size ${id}`);
  return found;
};

/** Each QR's left edge, magnification and data. */
function qrCodes(zpl: string) {
  return [...zpl.matchAll(/\^FO(\d+),\d+\^BQN,2,(\d+)\^FDMA,([^^]+)\^FS/g)].map(
    ([, x, magnification, url]) => ({
      x: Number(x),
      magnification: Number(magnification),
      url
    })
  );
}

describe("generateKanbanLabelZPL", () => {
  it("prints exactly one code per card, captioned with its action", () => {
    const cases = [
      ["order", `${baseUrl}/api/kanban/${item.id}`, "CREATE"],
      ["start", `${baseUrl}/api/kanban/start/${item.id}`, "START"],
      ["complete", `${baseUrl}/api/kanban/complete/${item.id}`, "COMPLETE"]
    ] as const;
    for (const [action, url, caption] of cases) {
      const zpl = generateKanbanLabelZPL(
        item,
        size("label3x2"),
        baseUrl,
        action
      );
      expect(qrCodes(zpl).map((q) => q.url)).toEqual([url]);
      expect(zpl).toContain(`^FD${caption}^FS`);
    }
  });

  it("prints the Create card by default", () => {
    const zpl = generateKanbanLabelZPL(item, size("label4x2"), baseUrl);
    expect(qrCodes(zpl).map((q) => q.url)).toEqual([
      `${baseUrl}/api/kanban/${item.id}`
    ]);
  });

  it("prints the kanban ID, the supplier and MIN on its own line", () => {
    const zpl = generateKanbanLabelZPL(
      { ...item, replenishmentLevel: 20 },
      size("label3x2"),
      baseUrl
    );
    for (const text of [
      "KB000002",
      "McMaster-Carr",
      "QTY: 100 EA",
      "MIN: 20"
    ]) {
      expect(zpl).toContain(`^FH^FD${text}^FS`);
    }
  });

  it("right-aligns the code", () => {
    for (const id of ["label3x2", "label4x2"]) {
      const labelSize = size(id);
      // The Complete URL is 65 bytes: QR version 5, 37 modules.
      const [qr] = qrCodes(
        generateKanbanLabelZPL(item, labelSize, baseUrl, "complete")
      );
      const right = qr!.x + qr!.magnification * 37;
      const widthDots = Math.round(labelSize.width * 203);
      // Ends at the right margin (0.08", 16 dots at 203 dpi).
      expect(widthDots - right).toBe(16);
    }
  });

  it("keeps the code inside the label", () => {
    for (const id of ["label3x2", "label4x2", "label100x50mm"]) {
      const labelSize = size(id);
      const zpl = generateKanbanLabelZPL(item, labelSize, baseUrl, "complete");
      const widthDots = Math.round(labelSize.width * 203);
      for (const qr of qrCodes(zpl)) {
        // 37 modules: the URLs here need QR version 5.
        expect(qr.x + qr.magnification * 37).toBeLessThanOrEqual(widthDots);
      }
    }
  });

  it("escapes field-data control characters in user text", () => {
    const zpl = generateKanbanLabelZPL(
      { ...item, itemName: "A^B~C_D" },
      size("label4x2"),
      baseUrl
    );
    expect(zpl).toContain("^FH^FDA_5EB_7EC_5FD^FS");
  });
});

describe("canHoldKanbanLabel", () => {
  it("takes 3 x 2 inch labels and larger", () => {
    expect(canHoldKanbanLabel(size("label3x2"))).toBe(true);
    expect(canHoldKanbanLabel(size("label4x2"))).toBe(true);
    expect(canHoldKanbanLabel(size("label100x50mm"))).toBe(true);
    expect(canHoldKanbanLabel(size("label2x1"))).toBe(false);
    expect(canHoldKanbanLabel(size("label50x25mm"))).toBe(false);
  });
});

describe("wrapKanbanLabelText", () => {
  // 1" at a 0.1" font fits 18 characters (0.55 of the font height each).
  it("keeps a name that fits on one line", () => {
    expect(wrapKanbanLabelText("Gearbox", 1, 0.1)).toEqual(["Gearbox"]);
  });

  it("breaks a longer name at a space onto a second line", () => {
    expect(wrapKanbanLabelText("Gearbox Sub-Assembly Left", 1, 0.1)).toEqual([
      "Gearbox",
      "Sub-Assembly Left"
    ]);
  });

  it("cuts the second line when the name is longer still", () => {
    // The cut line is 18 characters, the three dots included.
    expect(
      wrapKanbanLabelText("M6 Socket Head Cap Screw, Stainless Steel", 1, 0.1)
    ).toEqual(["M6 Socket Head Cap", "Screw, Stainles..."]);
  });
});
