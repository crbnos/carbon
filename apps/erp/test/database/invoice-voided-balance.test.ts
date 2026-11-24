// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A voided invoice owes nothing, against the live database: the invoice list
// views read its balance as 0, so the list's Balance total and the exports
// leave it out.

import { expect } from "vitest";
import {
  postPurchaseInvoice,
  postSalesInvoice
} from "../../app/modules/invoicing/invoicing.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  postServiceInvoice,
  postSuppliesInvoice
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";

/** NUMERIC reads as a string; a NULL balance stays null so it fails `0`. */
function amount(value: unknown) {
  return value === null ? null : Number(value);
}

async function salesListRow(f: Fixture, invoiceId: string) {
  const row = await f.db
    .selectFrom("salesInvoices")
    .select(["status", "balance"])
    .where("id", "=", invoiceId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return { status: row.status, balance: amount(row.balance) };
}

async function purchaseListRow(f: Fixture, invoiceId: string) {
  const row = await f.db
    .selectFrom("purchaseInvoices")
    .select(["status", "balance"])
    .where("id", "=", invoiceId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return { status: row.status, balance: amount(row.balance) };
}

databaseTest("a voided sales invoice has no balance", async () => {
  const f = await alwaysPostFixture();
  try {
    // The service invoice bills 100 with no tax.
    const invoiceId = await postServiceInvoice(f);
    expect(await salesListRow(f, invoiceId)).toEqual({
      status: "Submitted",
      balance: 100
    });

    const voided = await invokePosting(
      handlesOf(f.ctx),
      "post-sales-invoice",
      { type: "void", invoiceId },
      postSalesInvoice
    );
    expect(voided.error).toBeNull();
    expect(await salesListRow(f, invoiceId)).toEqual({
      status: "Voided",
      balance: 0
    });
  } finally {
    await f.cleanup();
  }
});

databaseTest("a voided purchase invoice has no balance", async () => {
  const f = await alwaysPostFixture();
  try {
    // The supplies invoice bills 60 with no tax.
    const invoiceId = await postSuppliesInvoice(f);
    expect(await purchaseListRow(f, invoiceId)).toEqual({
      status: "Open",
      balance: 60
    });

    const voided = await invokePosting(
      handlesOf(f.ctx),
      "post-purchase-invoice",
      { type: "void", invoiceId },
      postPurchaseInvoice
    );
    expect(voided.error).toBeNull();
    expect(await purchaseListRow(f, invoiceId)).toEqual({
      status: "Voided",
      balance: 0
    });
  } finally {
    await f.cleanup();
  }
});
