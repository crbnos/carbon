// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { projectPostingFixture } from "../lib/project-posting-test-fixture";
import { databaseTest } from "../local-database-test-fixture";
import {
  allocateToStripes,
  stripeCostLedgerRows,
  stripeItemLedgerRows
} from "./grouped-receipt";
import postReceipt from "./index";

describe("allocateToStripes", () => {
  const stripes = [
    { projectId: "p1", quantity: 2, pegId: "a" },
    { projectId: "p2", quantity: 1, pegId: "b" }
  ];

  it("cuts one untracked row at each stripe", () => {
    expect(
      allocateToStripes([3], stripes).map((piece) => [
        piece.rowIndex,
        piece.quantity,
        piece.stripe.projectId
      ])
    ).toEqual([
      [0, 2, "p1"],
      [0, 1, "p2"]
    ]);
  });

  it("assigns serial rows to stripes in order", () => {
    expect(
      stripeItemLedgerRows(
        [
          { quantity: 1, trackedEntityId: "s1" },
          { quantity: 1, trackedEntityId: "s2" },
          { quantity: 1, trackedEntityId: "s3" }
        ],
        stripes
      ).rows.map((row) => [row.trackedEntityId, row.projectId])
    ).toEqual([
      ["s1", "p1"],
      ["s2", "p1"],
      ["s3", "p2"]
    ]);
  });

  it("gives a lot that spans 2 stripes 2 rows with the same tracked entity", () => {
    const { rows, pegIds } = stripeItemLedgerRows(
      [{ quantity: 3, trackedEntityId: "lot" }],
      stripes
    );
    expect(rows).toEqual([
      { quantity: 2, trackedEntityId: "lot", projectId: "p1" },
      { quantity: 1, trackedEntityId: "lot", projectId: "p2" }
    ]);
    expect(pegIds).toEqual(["a", "b"]);
  });

  it("splits layers at the receipt's unit cost and keeps their totals", () => {
    const rows = stripeCostLedgerRows(
      [
        { quantity: 1, cost: 3.33, nominalCost: 3, remainingQuantity: 1 },
        { quantity: 2, cost: 6.67, nominalCost: 6, remainingQuantity: 2 }
      ],
      [
        { projectId: "p1", quantity: 1.5, pegId: "a" },
        { projectId: "p2", quantity: 1.5, pegId: "b" }
      ]
    );
    expect(rows.map((row) => [row.projectId, row.quantity, row.cost])).toEqual([
      ["p1", 1, 3.33],
      ["p1", 0.5, 1.6675],
      ["p2", 1.5, 5.0025]
    ]);
  });
});

// Projects Phase 3: a PO line made for a planning group splits its receipt
// into the members' stripes by the line's pegs, and the void turns the pegs
// Soft again.
databaseTest(
  "a grouped receipt writes one striped row per peg and its void re-softens the pegs",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const part = await f.addItem("part", { itemTrackingType: "Inventory" });
      const group = await f.addPlanningGroup({
        locationId,
        members: [
          { key: "101", identifier: "PA" },
          { key: "102", identifier: "PB" },
          { key: "103", identifier: "PC" }
        ]
      });
      const po = await f.addPurchaseOrder("grouped", {
        locationId,
        lines: [
          {
            itemId: part.itemId,
            quantity: 60,
            unitPrice: 10,
            planningGroupId: group.planningGroupId
          }
        ]
      });
      const pegs = [
        ["101", 20, "2026-11-01"],
        ["102", 30, "2026-11-02"],
        ["103", 10, "2026-11-03"]
      ] as const;
      for (const [member, quantity, needDate] of pegs) {
        await f.addPeg({
          planningGroupId: group.planningGroupId,
          itemId: part.itemId,
          locationId,
          supplyType: "Purchase Order Line",
          supplyId: po.lineIds[0]!,
          projectId: group.projectIds[member]!,
          quantity,
          needDate
        });
      }
      const receipt = await f.addReceipt("grouped", {
        locationId,
        purchaseOrderId: po.purchaseOrderId,
        supplierId: po.supplierId,
        lines: [
          {
            lineId: po.lineIds[0]!,
            itemId: part.itemId,
            quantity: 60,
            unitPrice: 10
          }
        ]
      });

      const posted = await postReceipt(f.ctx, { receiptId: receipt.receiptId });
      expect(posted.error).toBeNull();

      const member = (key: string) => group.projectIds[key]!;
      // 1. One striped receipt row per peg.
      const ledger = await f.db
        .selectFrom("itemLedger")
        .select(["id", "quantity", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", part.itemId)
        .orderBy("quantity")
        .execute();
      expect(
        ledger.map((row) => [Number(row.quantity), row.projectId])
      ).toEqual([
        [10, member("103")],
        [20, member("101")],
        [30, member("102")]
      ]);

      // 2. One cost layer per stripe, at the receipt's unit cost.
      const layers = await f.db
        .selectFrom("costLedger")
        .select(["quantity", "cost", "remainingQuantity", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", part.itemId)
        .orderBy("quantity")
        .execute();
      expect(
        layers.map((layer) => [
          Number(layer.quantity),
          Number(layer.cost),
          Number(layer.remainingQuantity),
          layer.projectId
        ])
      ).toEqual([
        [10, 100, 10, member("103")],
        [20, 200, 20, member("101")],
        [30, 300, 30, member("102")]
      ]);

      // 3. Inventory is debited once, as for a common receipt.
      const debits = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Receipt")
        .where("documentId", "=", receipt.receiptId)
        .where("accountId", "!=", f.account("grni"))
        .execute();
      expect(
        debits.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([[f.account("inventory"), 600]]);

      // 4. Three Hard pegs, each pointing at its row; no Soft peg is left.
      const currentPegs = () =>
        f.db
          .selectFrom("projectPeg")
          .select(["projectId", "quantity", "state", "itemLedgerId"])
          .where("companyId", "=", f.companyId)
          .where("supersededAt", "is", null)
          .orderBy("quantity")
          .execute();
      const hard = await currentPegs();
      expect(
        hard.map((peg) => [peg.projectId, Number(peg.quantity), peg.state])
      ).toEqual([
        [member("103"), 10, "Hard"],
        [member("101"), 20, "Hard"],
        [member("102"), 30, "Hard"]
      ]);
      const rowIdByProject = new Map(
        ledger.map((row) => [row.projectId, row.id])
      );
      for (const peg of hard) {
        expect(peg.itemLedgerId).toEqual(rowIdByProject.get(peg.projectId));
      }

      // The void reverses each stripe and turns the pegs Soft again.
      const voided = await postReceipt(f.ctx, {
        type: "void",
        receiptId: receipt.receiptId
      });
      expect(voided.error).toBeNull();
      const reversals = await f.db
        .selectFrom("itemLedger")
        .select(["quantity", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", part.itemId)
        .where("quantity", "<", 0)
        .orderBy("quantity", "desc")
        .execute();
      expect(
        reversals.map((row) => [Number(row.quantity), row.projectId])
      ).toEqual([
        [-10, member("103")],
        [-20, member("101")],
        [-30, member("102")]
      ]);
      const soft = await currentPegs();
      expect(
        soft.map((peg) => [
          peg.projectId,
          Number(peg.quantity),
          peg.state,
          peg.itemLedgerId
        ])
      ).toEqual([
        [member("103"), 10, "Soft", null],
        [member("101"), 20, "Soft", null],
        [member("102"), 30, "Soft", null]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

// A negative receipt on a grouped PO line takes the units back in the
// reverse of the distribution: the excess first, then the Hard pegs latest
// first. The pegs it takes turn Soft again, as on a void.
databaseTest(
  "a negative receipt on a grouped line takes the excess, then the latest Hard pegs, and re-softens them",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const part = await f.addItem("part", { itemTrackingType: "Inventory" });
      const group = await f.addPlanningGroup({
        locationId,
        members: [
          { key: "101", identifier: "PA" },
          { key: "102", identifier: "PB" },
          { key: "103", identifier: "PC" }
        ]
      });
      const po = await f.addPurchaseOrder("grouped", {
        locationId,
        lines: [
          {
            itemId: part.itemId,
            quantity: 65,
            unitPrice: 10,
            planningGroupId: group.planningGroupId
          }
        ]
      });
      const pegs = [
        ["101", 20, "2026-11-01"],
        ["102", 30, "2026-11-02"],
        ["103", 10, "2026-11-03"]
      ] as const;
      for (const [member, quantity, needDate] of pegs) {
        await f.addPeg({
          planningGroupId: group.planningGroupId,
          itemId: part.itemId,
          locationId,
          supplyType: "Purchase Order Line",
          supplyId: po.lineIds[0]!,
          projectId: group.projectIds[member]!,
          quantity,
          needDate
        });
      }
      const line = (quantity: number) => ({
        locationId,
        purchaseOrderId: po.purchaseOrderId,
        supplierId: po.supplierId,
        lines: [
          {
            lineId: po.lineIds[0]!,
            itemId: part.itemId,
            quantity,
            unitPrice: 10
          }
        ]
      });

      // Receive 65: 20, 30 and 10 to the members, 5 of excess to common stock.
      const receipt = await f.addReceipt("in", line(65));
      expect(
        (await postReceipt(f.ctx, { receiptId: receipt.receiptId })).error
      ).toBeNull();

      // Return 18: the 5 of excess, P-103's 10, then 3 of P-102's 30.
      const giveBack = await f.addReceipt("back", line(-18));
      expect(
        (await postReceipt(f.ctx, { receiptId: giveBack.receiptId })).error
      ).toBeNull();

      const member = (key: string) => group.projectIds[key]!;
      const returned = await f.db
        .selectFrom("itemLedger")
        .select(["quantity", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", part.itemId)
        .where("documentId", "=", giveBack.receiptId)
        .orderBy("quantity")
        .execute();
      expect(
        returned.map((row) => [Number(row.quantity), row.projectId])
      ).toEqual([
        [-10, member("103")],
        [-5, null],
        [-3, member("102")]
      ]);

      // Each stripe's layer gives up the returned units at the layer cost.
      const consumed = await f.db
        .selectFrom("costLedger")
        .select(["quantity", "cost", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", part.itemId)
        .where("documentId", "=", giveBack.receiptId)
        .orderBy("quantity")
        .execute();
      expect(
        consumed.map((row) => [
          Number(row.quantity),
          Number(row.cost),
          row.projectId
        ])
      ).toEqual([
        [-10, -100, member("103")],
        [-5, -50, null],
        [-3, -30, member("102")]
      ]);
      const credits = await f.db
        .selectFrom("journalLine")
        .select(["amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Receipt")
        .where("documentId", "=", giveBack.receiptId)
        .where("accountId", "=", f.account("inventory"))
        .execute();
      expect(credits.map((row) => Number(row.amount))).toEqual([-180]);

      const current = await f.db
        .selectFrom("projectPeg")
        .select(["projectId", "quantity", "state"])
        .where("companyId", "=", f.companyId)
        .where("supersededAt", "is", null)
        .orderBy("state")
        .orderBy("quantity")
        .execute();
      expect(
        current.map((peg) => [peg.projectId, Number(peg.quantity), peg.state])
      ).toEqual([
        // the enum order: Soft, then Hard
        [member("102"), 3, "Soft"],
        [member("103"), 10, "Soft"],
        [member("101"), 20, "Hard"],
        [member("102"), 27, "Hard"]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
