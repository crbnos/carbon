// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A rounding adjustment on a Draft purchase invoice, against the live
// database: one line on the rounding account carries the difference, a second
// call replaces it, and matching the other lines removes it.

import { round } from "@carbon/utils";
import { describe, expect } from "vitest";
import {
  adjustPurchaseInvoiceRounding,
  postPurchaseInvoice,
  ROUNDING_LINE_DESCRIPTION
} from "../../app/modules/invoicing/invoicing.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";

/** A Draft invoice like APV-000180: 13 x 5.81 + 5.29 tax + 12.64 shipping. */
async function draftInvoice(f: Fixture) {
  const invoiceId = `${f.prefix}-rounding-invoice`;
  await seed(f, async (trx) => {
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseInvoice")
      .values({
        id: invoiceId,
        invoiceId: "PI-ROUND",
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "Draft",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("purchaseInvoiceDelivery")
      .values({
        id: invoiceId,
        companyId: f.companyId,
        supplierShippingCost: 12.64
      })
      .execute();
    await trx
      .insertInto("purchaseInvoiceLine")
      .values({
        invoiceId,
        invoiceLineType: "G/L Account",
        accountId: f.account("supplies"),
        quantity: 13,
        supplierUnitPrice: 5.81,
        supplierTaxAmount: 5.29,
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return invoiceId;
}

function roundingLines(f: Fixture, invoiceId: string) {
  return f.db
    .selectFrom("purchaseInvoiceLine")
    .select(["accountId", "description", "quantity", "supplierUnitPrice"])
    .where("invoiceId", "=", invoiceId)
    .where("companyId", "=", f.companyId)
    .where("accountId", "=", f.account("filler"))
    .execute();
}

describe("adjustPurchaseInvoiceRounding", () => {
  databaseTest(
    "adds, replaces and removes one rounding line",
    async () => {
      const f = await alwaysPostFixture();
      try {
        const invoiceId = await draftInvoice(f);

        expect(
          await adjustPurchaseInvoiceRounding(f.service, {
            invoiceId,
            targetTotal: 93.47
          })
        ).toEqual({ amount: 0.01 });
        // The fixture's rounding account default is its filler account.
        expect(await roundingLines(f, invoiceId)).toEqual([
          {
            accountId: f.account("filler"),
            description: ROUNDING_LINE_DESCRIPTION,
            quantity: 1,
            supplierUnitPrice: 0.01
          }
        ]);

        // Again with the same total: still one line, same amount.
        await adjustPurchaseInvoiceRounding(f.service, {
          invoiceId,
          targetTotal: 93.47
        });
        expect(await roundingLines(f, invoiceId)).toHaveLength(1);

        await adjustPurchaseInvoiceRounding(f.service, {
          invoiceId,
          targetTotal: 93.45
        });
        expect(
          (await roundingLines(f, invoiceId)).map((l) => l.supplierUnitPrice)
        ).toEqual([-0.01]);

        await adjustPurchaseInvoiceRounding(f.service, {
          invoiceId,
          targetTotal: 93.46
        });
        expect(await roundingLines(f, invoiceId)).toEqual([]);

        await expect(
          adjustPurchaseInvoiceRounding(f.service, {
            invoiceId,
            targetTotal: 95
          })
        ).rejects.toThrow(/too large for a rounding adjustment/);
      } finally {
        await f.cleanup();
      }
    }
  );

  databaseTest(
    "posts payables at the charged amount and leaves other lines alone",
    async () => {
      const f = await alwaysPostFixture();
      try {
        const invoiceId = await draftInvoice(f);
        // An ordinary expense line on the rounding account is not the
        // rounding line: the adjustment adds its own beside it.
        await seed(f, (trx) =>
          trx
            .insertInto("purchaseInvoiceLine")
            .values({
              invoiceId,
              invoiceLineType: "G/L Account",
              accountId: f.account("filler"),
              description: "Card fee",
              quantity: 1,
              supplierUnitPrice: 0.3,
              exchangeRate: 1,
              companyId: f.companyId,
              createdBy: USER
            })
            .execute()
        );

        await adjustPurchaseInvoiceRounding(f.service, {
          invoiceId,
          targetTotal: 93.77
        });
        expect(
          (await roundingLines(f, invoiceId))
            .map((l) => [l.description, l.supplierUnitPrice])
            .sort()
        ).toEqual([
          ["Card fee", 0.3],
          [ROUNDING_LINE_DESCRIPTION, 0.01]
        ]);

        unwrap(
          await invokePosting(
            handlesOf(f.ctx),
            "post-purchase-invoice",
            { type: "post", invoiceId },
            postPurchaseInvoice
          )
        );
        const payables = await f.db
          .selectFrom("journalLine")
          .select("amount")
          .where("companyId", "=", f.companyId)
          .where("documentType", "=", "Invoice")
          .where("documentId", "=", invoiceId)
          .where("accountId", "=", f.account("payables"))
          .execute();
        expect(
          round(payables.reduce((sum, l) => sum + Number(l.amount), 0), 2)
        ).toBe(93.77);
      } finally {
        await f.cleanup();
      }
    }
  );

  databaseTest("refuses an invoice that is not Draft", async () => {
    const f = await alwaysPostFixture();
    try {
      const invoiceId = await draftInvoice(f);
      await f.db
        .updateTable("purchaseInvoice")
        .set({ status: "Open" })
        .where("id", "=", invoiceId)
        .execute();
      await expect(
        adjustPurchaseInvoiceRounding(f.service, {
          invoiceId,
          targetTotal: 93.47
        })
      ).rejects.toThrow(/Only a Draft purchase invoice/);
    } finally {
      await f.cleanup();
    }
  });
});
