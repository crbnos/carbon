import { describe, expect, it } from "vitest";
import {
  acquisitionLines,
  disposalCombinedLines,
  disposalInvoiceLines,
  disposalShipmentLines,
  type FixedAssetPostingLine,
  type FixedAssetPostingRole,
  fixedAssetNetBookValue,
  sumPostingLines,
  toStoredFixedAssetAmount
} from "./fixed-asset";

const roleAmount = (
  lines: FixedAssetPostingLine[],
  role: FixedAssetPostingRole
) =>
  lines
    .filter((l) => l.role === role)
    .reduce((total, l) => total + l.amount, 0);

describe("fixed-asset GAAP posting", () => {
  // AC0 / AC5 — manual registration posts an acquisition JE: Dr asset / Cr source.
  describe("acquisition (manual register)", () => {
    it("debits the asset account and credits the acquisition source at cost", () => {
      const lines = acquisitionLines(1000);
      expect(roleAmount(lines, "asset")).toBe(1000); // debit
      expect(roleAmount(lines, "acquisitionSource")).toBe(-1000); // credit
      expect(sumPostingLines(lines)).toBe(0); // balanced
    });
  });

  describe("disposal shipment leg (AC1, AC4 — zero P&L)", () => {
    const cost = 1000;
    const accumDep = 300; // NBV = 700
    const lines = disposalShipmentLines(cost, accumDep);

    it("moves NBV into Disposal Clearing, not the write-off / disposal P&L account", () => {
      expect(roleAmount(lines, "disposalClearing")).toBe(700); // debit NBV
      // No gain/loss (disposal P&L) recognized at shipment → zero P&L impact.
      expect(lines.some((l) => l.role === "disposal")).toBe(false);
    });

    it("clears accumulated depreciation and removes the asset at cost, balanced", () => {
      expect(roleAmount(lines, "accumulatedDepreciation")).toBe(300);
      expect(roleAmount(lines, "asset")).toBe(-1000);
      expect(sumPostingLines(lines)).toBe(0);
    });

    it("touches only Balance Sheet roles (no P&L)", () => {
      const balanceSheetOnly: FixedAssetPostingRole[] = [
        "asset",
        "accumulatedDepreciation",
        "disposalClearing"
      ];
      expect(lines.every((l) => balanceSheetOnly.includes(l.role))).toBe(true);
    });
  });

  describe("disposal invoice leg (AC2, AC3, AC6)", () => {
    it("drains Disposal Clearing and books the GAIN to the disposal account", () => {
      const nbv = 700;
      const proceeds = 1000; // gain = 300
      const lines = disposalInvoiceLines(nbv, proceeds);
      expect(roleAmount(lines, "accountsReceivable")).toBe(1000); // debit AR
      expect(roleAmount(lines, "disposalClearing")).toBe(-700); // credit (drain)
      // gain → credit the disposal (gain/loss) account
      expect(roleAmount(lines, "disposal")).toBe(-300);
      expect(sumPostingLines(lines)).toBe(0);
    });

    it("books a LOSS as a debit to the disposal account", () => {
      const nbv = 700;
      const proceeds = 500; // loss = 200
      const lines = disposalInvoiceLines(nbv, proceeds);
      expect(roleAmount(lines, "disposal")).toBe(200); // debit (loss)
      expect(sumPostingLines(lines)).toBe(0);
    });

    it("never touches the write-off account across a full ship→invoice disposal", () => {
      const cost = 1000;
      const accumDep = 300;
      const proceeds = 1000;
      const nbv = fixedAssetNetBookValue(cost, accumDep);
      const both = [
        ...disposalShipmentLines(cost, accumDep),
        ...disposalInvoiceLines(nbv, proceeds)
      ];
      // Disposal Clearing nets to zero (parked at shipment, drained at invoice).
      expect(roleAmount(both, "disposalClearing")).toBe(0);
      // Gain/loss lands only on the disposal account.
      expect(roleAmount(both, "disposal")).toBe(-(proceeds - nbv));
      // No line ever routes to a write-off account → it nets to zero.
      expect(both.some((l) => (l.role as string) === "writeOff")).toBe(false);
    });
  });

  describe("combined / scrap disposal (manual)", () => {
    it("scrap (no proceeds) books the full NBV as a loss to the disposal account", () => {
      const lines = disposalCombinedLines(1000, 300, 0); // NBV 700, loss 700
      expect(roleAmount(lines, "accountsReceivable")).toBe(0); // none
      expect(roleAmount(lines, "disposal")).toBe(700); // debit loss
      expect(roleAmount(lines, "asset")).toBe(-1000);
      expect(sumPostingLines(lines)).toBe(0);
    });
  });

  describe("toStoredFixedAssetAmount sign convention", () => {
    it("stores an asset debit positive and an asset credit negative", () => {
      expect(toStoredFixedAssetAmount({ role: "asset", amount: 500 })).toBe(
        500
      );
      expect(toStoredFixedAssetAmount({ role: "asset", amount: -500 })).toBe(
        -500
      );
    });
    it("stores a GR/IR (liability) credit as an increase and a gain as a P&L credit", () => {
      // Credit to GR/IR clearing increases the liability → stored positive.
      expect(
        toStoredFixedAssetAmount({ role: "acquisitionSource", amount: -500 })
      ).toBe(500);
      // Gain credits the disposal (expense-classed) account → stored negative.
      expect(toStoredFixedAssetAmount({ role: "disposal", amount: -300 })).toBe(
        -300
      );
    });
  });
});
