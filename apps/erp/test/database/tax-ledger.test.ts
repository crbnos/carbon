// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Posting a document with a tax code writes the tax ledger beside its journal
// (.ai/specs/2026-10-16-multi-jurisdiction-tax.md, "The tax subledger"), and a
// void negates those rows.

import { parseDate } from "@internationalized/date";
import { expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  journalLinesOf,
  newJournals,
  seed,
  stampCutover,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";
import {
  getTaxLiability,
  getTaxLiabilityBaseTotals,
  upsertTaxCode
} from "~/modules/accounting/accounting.service";
import {
  postPurchaseInvoice,
  postSalesInvoice
} from "~/modules/invoicing/invoicing.service";
import { invokePosting } from "~/modules/shared/shared.service";

/** A tax code with its components; the tax accounts point at real leaves. */
async function taxCode(
  f: Fixture,
  key: string,
  components: Array<{
    name: string;
    taxPercent: number;
    recoverablePercent?: number;
    effectiveDate?: string;
    expirationDate?: string;
  }>,
  calculationType: "Normal" | "Reverse Charge" = "Normal"
): Promise<string> {
  const id = `${f.prefix}-tax-${key}`;
  await seed(f, async (trx) => {
    await trx
      .updateTable("accountDefault")
      .set({
        taxReceivedAccount: f.account("grni"),
        taxPaidAccount: f.account("filler")
      })
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .insertInto("taxCode")
      .values({
        id,
        name: id,
        calculationType,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("taxCodeComponent")
      .values(
        components.map((c, index) => ({
          id: `${id}-${index}`,
          taxCodeId: id,
          name: c.name,
          taxPercent: c.taxPercent,
          recoverablePercent: c.recoverablePercent ?? 0,
          effectiveDate: c.effectiveDate ?? null,
          expirationDate: c.expirationDate ?? null,
          sequence: index + 1,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });
  return id;
}

/** A Draft sales invoice of one 1,000 Service line under `code`. */
async function draftTaxedSalesInvoice(
  f: Fixture,
  key: string,
  args: { code: string; taxPercent: number; dateIssued?: string }
): Promise<string> {
  const invoiceId = `${f.prefix}-sales-invoice-${key}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("salesInvoice")
      .values({
        id: invoiceId,
        invoiceId: `INV-${key}`,
        customerId: f.customerId,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "Draft",
        dateIssued: args.dateIssued ?? null,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesInvoiceShipment")
      .values({
        id: invoiceId,
        shippingCost: 0,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesInvoiceLine")
      .values({
        invoiceId,
        invoiceLineType: "Service",
        itemId: f.serviceId,
        quantity: 1,
        unitPrice: 1000,
        taxPercent: args.taxPercent,
        taxCodeId: args.code,
        exchangeRate: 1,
        unitOfMeasureCode: "EA",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return invoiceId;
}

const postSales = (f: Fixture, invoiceId: string) =>
  invokePosting(
    handlesOf(f.ctx),
    "post-sales-invoice",
    { type: "post", invoiceId },
    postSalesInvoice
  );

async function ledgerOf(f: Fixture, documentId: string) {
  return f.db
    .selectFrom("taxLedger")
    .select([
      "componentName",
      "taxableAmount",
      "taxAmount",
      "recoverableAmount",
      "selfAssessed",
      "journalId"
    ])
    .where("companyId", "=", f.companyId)
    .where("documentId", "=", documentId)
    .orderBy("createdAt")
    .orderBy("componentName")
    .execute();
}

databaseTest(
  "a sales invoice with a two-component code posts a tax leg and a ledger row per component, and its void nets them to zero",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const code = await taxCode(f, "austin", [
        { name: "TX State", taxPercent: 0.0625 },
        { name: "City of Austin", taxPercent: 0.02 }
      ]);
      const invoiceId = `${f.prefix}-sales-invoice`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("salesInvoice")
          .values({
            id: invoiceId,
            invoiceId: "INV-TAX",
            customerId: f.customerId,
            currencyCode: "USD",
            exchangeRate: 1,
            status: "Draft",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("salesInvoiceShipment")
          .values({
            id: invoiceId,
            shippingCost: 0,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("salesInvoiceLine")
          .values({
            invoiceId,
            invoiceLineType: "Service",
            itemId: f.serviceId,
            quantity: 1,
            unitPrice: 1000,
            taxPercent: 0.0825,
            taxCodeId: code,
            exchangeRate: 1,
            unitOfMeasureCode: "EA",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });

      const journals = await newJournals(f, async () =>
        unwrap(
          await invokePosting(
            handlesOf(f.ctx),
            "post-sales-invoice",
            { type: "post", invoiceId },
            postSalesInvoice
          )
        )
      );
      const lines = await journalLinesOf(f, journals);
      expect(
        lines
          .filter((line) => line.accountId === f.account("grni"))
          .map((line) => line.amount)
          .sort()
      ).toEqual([20, 62.5]);

      const posted = await ledgerOf(f, invoiceId);
      expect(
        posted.map((r) => [r.componentName, r.taxableAmount, r.taxAmount])
      ).toEqual([
        ["City of Austin", 1000, 20],
        ["TX State", 1000, 62.5]
      ]);

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-sales-invoice",
          { type: "void", invoiceId },
          postSalesInvoice
        )
      );
      const all = await ledgerOf(f, invoiceId);
      expect(all).toHaveLength(4);
      expect(all.reduce((t, r) => t + Number(r.taxAmount), 0)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a purchase invoice with recoverable VAT debits Tax Paid, keeps cost net and records the recoverable share",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const code = await taxCode(f, "uk20", [
        { name: "VAT", taxPercent: 0.2, recoverablePercent: 1 }
      ]);
      const invoiceId = `${f.prefix}-purchase-invoice-vat`;
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
            invoiceId: "PI-VAT",
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
          .values({ id: invoiceId, companyId: f.companyId })
          .execute();
        await trx
          .insertInto("purchaseInvoiceLine")
          .values({
            invoiceId,
            invoiceLineType: "G/L Account",
            accountId: f.account("supplies"),
            quantity: 1,
            supplierUnitPrice: 1000,
            supplierTaxAmount: 200,
            taxPercent: 0.2,
            taxCodeId: code,
            exchangeRate: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });

      const journals = await newJournals(f, async () =>
        unwrap(
          await invokePosting(
            handlesOf(f.ctx),
            "post-purchase-invoice",
            { type: "post", invoiceId },
            postPurchaseInvoice
          )
        )
      );
      const lines = await journalLinesOf(f, journals);
      const amountOn = (name: "supplies" | "filler" | "payables") =>
        lines
          .filter((line) => line.accountId === f.account(name))
          .reduce((t, line) => t + Number(line.amount), 0);
      expect(amountOn("supplies")).toBe(1000);
      expect(amountOn("filler")).toBe(200);
      expect(amountOn("payables")).toBe(1200);

      const [row] = await ledgerOf(f, invoiceId);
      expect(row).toMatchObject({ taxAmount: 200, recoverableAmount: 200 });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a reverse-charge purchase invoice records its rows as self-assessed, and the liability report keeps them after the code changes",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stampCutover(f);
      const code = await taxCode(
        f,
        "use-tax",
        [{ name: "Use Tax", taxPercent: 0.0825 }],
        "Reverse Charge"
      );
      const invoiceId = `${f.prefix}-purchase-invoice-rc`;
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
            invoiceId: "PI-RC",
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
          .values({ id: invoiceId, companyId: f.companyId })
          .execute();
        await trx
          .insertInto("purchaseInvoiceLine")
          .values({
            invoiceId,
            invoiceLineType: "G/L Account",
            accountId: f.account("supplies"),
            quantity: 1,
            supplierUnitPrice: 1000,
            supplierTaxAmount: 0,
            taxPercent: 0.0825,
            taxCodeId: code,
            exchangeRate: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-purchase-invoice",
          { type: "post", invoiceId },
          postPurchaseInvoice
        )
      );
      const rows = await ledgerOf(f, invoiceId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        componentName: "Use Tax",
        taxAmount: 82.5,
        selfAssessed: true
      });

      const selfAssessedTax = async () =>
        (
          await getTaxLiability(f.db, f.companyId, {
            startDate: f.cutoverDate,
            endDate: f.periodEnd
          })
        ).find((row) => row.componentName === "Use Tax")?.selfAssessedTax;
      expect(await selfAssessedTax()).toBe(82.5);

      // The ledger is a snapshot: a code edited after posting changes no
      // past figure.
      await f.db
        .updateTable("taxCode")
        .set({ calculationType: "Normal" })
        .where("id", "=", code)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(await selfAssessedTax()).toBe(82.5);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a sales invoice splits its tax with the components in force on its date issued, not on the posting date",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const yesterday = parseDate(f.today).subtract({ days: 1 }).toString();
      const code = await taxCode(f, "county-change", [
        { name: "State", taxPercent: 0.0725 },
        { name: "County", taxPercent: 0.0225, expirationDate: yesterday },
        { name: "County 2.5", taxPercent: 0.025, effectiveDate: f.today }
      ]);
      const invoiceId = await draftTaxedSalesInvoice(f, "county", {
        code,
        taxPercent: 0.095,
        dateIssued: yesterday
      });
      unwrap(await postSales(f, invoiceId));
      const rows = await ledgerOf(f, invoiceId);
      expect(rows.map((r) => [r.componentName, r.taxAmount])).toEqual([
        ["County", 22.5],
        ["State", 72.5]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a sales invoice whose code has no component in force on its date issued is refused, and posts nothing",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const yesterday = parseDate(f.today).subtract({ days: 1 }).toString();
      const code = await taxCode(f, "expired", [
        { name: "Expired", taxPercent: 0.1, expirationDate: yesterday }
      ]);
      const invoiceId = await draftTaxedSalesInvoice(f, "expired", {
        code,
        taxPercent: 0.1,
        dateIssued: f.today
      });
      const journals = await newJournals(f, async () => {
        const result = await postSales(f, invoiceId);
        expect(result.error?.message).toContain("has no component in force");
      });
      expect(journals).toEqual([]);
      expect(await ledgerOf(f, invoiceId)).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the liability report's taxable total counts a two-component line once",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stampCutover(f);
      const code = await taxCode(f, "austin-total", [
        { name: "TX State", taxPercent: 0.0625 },
        { name: "City of Austin", taxPercent: 0.02 }
      ]);
      const invoiceId = await draftTaxedSalesInvoice(f, "total", {
        code,
        taxPercent: 0.0825
      });
      unwrap(await postSales(f, invoiceId));
      const filters = { startDate: f.cutoverDate, endDate: f.periodEnd };
      const rows = await getTaxLiability(f.db, f.companyId, filters);
      // Each component row carries the line's whole base...
      expect(rows.map((row) => row.taxableSales)).toEqual([1000, 1000]);
      // ...so the total comes from the lines, once each.
      expect(
        await getTaxLiabilityBaseTotals(f.db, f.companyId, filters)
      ).toEqual({ taxableSales: 1000, exemptSales: 0, taxablePurchases: 0 });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a sales invoice whose line was rated on another date is refused until its taxes are recalculated",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const yesterday = parseDate(f.today).subtract({ days: 1 }).toString();
      const code = await taxCode(f, "rated-yesterday", [
        { name: "State", taxPercent: 0.0725 },
        { name: "County", taxPercent: 0.0225, expirationDate: yesterday },
        { name: "County 2.5", taxPercent: 0.025, effectiveDate: f.today }
      ]);
      // An order line rated yesterday (9.5%), invoiced today (9.75%).
      const invoiceId = await draftTaxedSalesInvoice(f, "rated-yesterday", {
        code,
        taxPercent: 0.095,
        dateIssued: f.today
      });
      const journals = await newJournals(f, async () => {
        const result = await postSales(f, invoiceId);
        expect(result.error?.message).toContain("Line 1 charges 9.5%");
        expect(result.error?.message).toContain(`is 9.75% on ${f.today}`);
        expect(result.error?.message).toContain("Recalculate taxes");
      });
      expect(journals).toEqual([]);
      expect(await ledgerOf(f, invoiceId)).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a component on posted tax records keeps its rate and dates; it can only expire, beside a new component",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const code = await taxCode(f, "locked", [
        { name: "VAT", taxPercent: 0.2 }
      ]);
      const invoiceId = await draftTaxedSalesInvoice(f, "locked", {
        code,
        taxPercent: 0.2,
        dateIssued: f.today
      });
      unwrap(await postSales(f, invoiceId));

      const save = (
        components: Array<{
          id?: string;
          name: string;
          taxPercent: number;
          effectiveDate?: string;
          expirationDate?: string;
        }>
      ) =>
        upsertTaxCode(f.db, {
          companyId: f.companyId,
          companyGroupId: f.groupId,
          userId: USER,
          taxCode: {
            id: code,
            name: code,
            calculationType: "Normal",
            reportingCategory: "Standard",
            taxesShipping: false,
            active: true
          },
          components: components.map((c, index) => ({
            recoverablePercent: 0,
            sequence: index + 1,
            isCompound: false,
            ...c
          }))
        } as Parameters<typeof upsertTaxCode>[1]);

      const rateChange = await save([
        { id: `${code}-0`, name: "VAT", taxPercent: 0.175 }
      ]);
      expect(rateChange.error).toContain("VAT is on posted tax records");
      const removal = await save([{ name: "VAT 17.5", taxPercent: 0.175 }]);
      expect(removal.error).toContain("VAT is on posted tax records");

      const tomorrow = parseDate(f.today).add({ days: 1 }).toString();
      const expired = await save([
        {
          id: `${code}-0`,
          name: "VAT",
          taxPercent: 0.2,
          expirationDate: f.today
        },
        { name: "VAT 17.5", taxPercent: 0.175, effectiveDate: tomorrow }
      ]);
      expect(expired.error).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a code's taxes-shipping change reaches its draft invoices' lines, not its posted ones",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const code = await taxCode(f, "shipping", [
        { name: "VAT", taxPercent: 0.2 }
      ]);
      const posted = await draftTaxedSalesInvoice(f, "shipping-posted", {
        code,
        taxPercent: 0.2,
        dateIssued: f.today
      });
      unwrap(await postSales(f, posted));
      const draft = await draftTaxedSalesInvoice(f, "shipping-draft", {
        code,
        taxPercent: 0.2,
        dateIssued: f.today
      });

      await f.db
        .updateTable("taxCode")
        .set({ taxesShipping: true })
        .where("id", "=", code)
        .where("companyId", "=", f.companyId)
        .execute();

      const flags = await f.db
        .selectFrom("salesInvoiceLine")
        .select(["invoiceId", "taxesShipping"])
        .where("companyId", "=", f.companyId)
        .where("invoiceId", "in", [posted, draft])
        .execute();
      expect(
        Object.fromEntries(flags.map((l) => [l.invoiceId, l.taxesShipping]))
      ).toEqual({ [posted]: false, [draft]: true });
    } finally {
      await f.cleanup();
    }
  }
);
