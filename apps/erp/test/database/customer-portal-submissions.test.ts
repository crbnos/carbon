// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { customerPortalPoValidator } from "../../app/modules/sales/sales.models";
import {
  findCustomerPortalSubmission,
  insertCustomerPortalPoSubmission,
  insertCustomerPortalRfqSubmission,
  isSentCustomerQuote
} from "../../app/modules/sales/sales.service";
import { alwaysPostFixture, type Fixture, USER } from "./fixtures/always-post";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";

let f: Fixture;
let other: Fixture;
let portalId: string;
let quoteId: string;
let otherQuoteId: string;

beforeAll(async () => {
  if (!hasLocalDatabase) return;
  f = await alwaysPostFixture();
  other = await alwaysPostFixture();
  portalId = crypto.randomUUID();
  quoteId = `${f.prefix}-quote`;
  otherQuoteId = `${other.prefix}-quote`;
  await f.db.transaction().execute(async (trx) => {
    await trx.insertInto("sequence").values({
      table: "salesRfq",
      name: "Sales RFQ",
      prefix: "RFQ-",
      companyId: f.companyId
    }).onConflict((oc) => oc.columns(["table", "companyId"]).doNothing()).execute();
    await trx.insertInto("externalLink").values({
      id: portalId,
      documentType: "Customer",
      documentId: f.customerId,
      customerId: f.customerId,
      companyId: f.companyId
    }).execute();
    await trx.insertInto("quote").values({
      id: quoteId,
      quoteId: `${f.prefix}-Q`,
      customerId: f.customerId,
      status: "Sent",
      currencyCode: "USD",
      exchangeRate: 1,
      companyId: f.companyId,
      createdBy: USER
    }).execute();
  });
  await other.db.insertInto("quote").values({
    id: otherQuoteId,
    quoteId: `${other.prefix}-Q`,
    customerId: other.customerId,
    status: "Sent",
    currencyCode: "USD",
    exchangeRate: 1,
    companyId: other.companyId,
    createdBy: USER
  }).execute();
}, 120_000);

afterAll(async () => {
  if (!hasLocalDatabase) return;
  await other.cleanup();
  await f.cleanup();
}, 120_000);

describe("customer portal submissions", () => {
  it("uses quote lines for a quoted PO and requires lines without a quote", () => {
    const input = {
      idempotencyKey: crypto.randomUUID(),
      poNumber: "HAS-4520",
      lines: [],
      file: new File(["%PDF-1.7"], "purchase-order.pdf", {
        type: "application/pdf"
      })
    };
    expect(customerPortalPoValidator.safeParse({ ...input, quoteId: "quote-test" }).success).toBe(true);
    expect(customerPortalPoValidator.safeParse(input).success).toBe(false);
  });

  databaseTest("creates one Draft RFQ with two lines for a repeated key", async () => {
    const args = {
      companyId: f.companyId,
      portalId,
      customerId: f.customerId,
      createdBy: USER,
      idempotencyKey: crypto.randomUUID(),
      requestFingerprint: "a".repeat(64),
      opportunityId: crypto.randomUUID(),
      rfqDate: f.today,
      quoteNeededBy: f.today,
      customerReference: "HAS-RFQ-112",
      notes: "Include certificates",
      lines: [
        { partNumber: "TTJ-300", quantity: 250, unitOfMeasureCode: "EA", delivery: "Q2" },
        { partNumber: "TTJ-200", quantity: 100, unitOfMeasureCode: "EA" }
      ],
      documentPaths: [`${f.companyId}/opportunity/file.pdf`]
    };
    const first = await insertCustomerPortalRfqSubmission(f.db, args);
    const repeat = await insertCustomerPortalRfqSubmission(f.db, {
      ...args,
      opportunityId: crypto.randomUUID()
    });
    expect(first.duplicate).toBe(false);
    expect(repeat).toMatchObject({ id: first.id, salesRfqId: first.salesRfqId, duplicate: true });
    await expect(insertCustomerPortalRfqSubmission(f.db, {
      ...args,
      requestFingerprint: "b".repeat(64)
    })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    const rfq = await f.db.selectFrom("salesRfq").select(["id", "customerId", "status", "expirationDate", "opportunityId"])
      .where("id", "=", first.salesRfqId!).executeTakeFirstOrThrow();
    expect(rfq).toMatchObject({ customerId: f.customerId, status: "Draft", expirationDate: f.today, opportunityId: args.opportunityId });
    const lines = await f.db.selectFrom("salesRfqLine").select(["customerPartId", "quantity", "externalNotes"])
      .where("salesRfqId", "=", rfq.id).orderBy("order").execute();
    expect(lines).toEqual([
      {
        customerPartId: "TTJ-300",
        quantity: [250],
        externalNotes: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Requested delivery: Q2" }] }]
        }
      },
      { customerPartId: "TTJ-200", quantity: [100], externalNotes: {} }
    ]);
    expect(await findCustomerPortalSubmission(f.db, args)).toMatchObject({ id: first.id, salesRfqId: rfq.id, submissionType: "RFQ" });
    await f.db.deleteFrom("salesRfq").where("id", "=", rfq.id).executeTakeFirstOrThrow();
    expect(await findCustomerPortalSubmission(f.db, args)).toMatchObject({
      id: first.id,
      salesRfqId: null,
      submissionType: "RFQ"
    });
  });

  databaseTest("keeps a quoted PO pending and refuses another company's quote", async () => {
    const args = {
      companyId: f.companyId,
      portalId,
      customerId: f.customerId,
      createdBy: USER,
      idempotencyKey: crypto.randomUUID(),
      requestFingerprint: "a".repeat(64),
      poNumber: "HAS-4520",
      quoteId,
      lines: [{ partNumber: "TTJ-300", quantity: 100, unitOfMeasureCode: "EA", unitPrice: 6700 }],
      documentPaths: [`${f.companyId}/customer-portal/${portalId}/po.pdf`]
    };
    expect(await isSentCustomerQuote(f.db, { companyId: f.companyId, customerId: f.customerId, quoteId })).toBe(true);
    expect(await isSentCustomerQuote(f.db, { companyId: f.companyId, customerId: f.customerId, quoteId: otherQuoteId })).toBe(false);
    const first = await insertCustomerPortalPoSubmission(f.db, args);
    const repeat = await insertCustomerPortalPoSubmission(f.db, args);
    expect(repeat).toMatchObject({ id: first.id, duplicate: true, submissionType: "PO" });
    await expect(insertCustomerPortalPoSubmission(f.db, {
      ...args,
      requestFingerprint: "b".repeat(64)
    })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    const submission = await f.db.selectFrom("customerPortalSubmission")
      .select(["status", "salesOrderId", "quoteId", "poNumber"])
      .where("id", "=", first.id).where("companyId", "=", f.companyId).executeTakeFirstOrThrow();
    expect(submission).toMatchObject({ status: "Pending", salesOrderId: null, quoteId, poNumber: args.poNumber });
    const quote = await f.db.selectFrom("quote").select("status").where("id", "=", quoteId).executeTakeFirstOrThrow();
    expect(quote.status).toBe("Sent");
    await expect(insertCustomerPortalPoSubmission(f.db, {
      ...args,
      idempotencyKey: crypto.randomUUID(),
      quoteId: otherQuoteId
    })).rejects.toThrow("QUOTE_NOT_AVAILABLE");
  });
});
