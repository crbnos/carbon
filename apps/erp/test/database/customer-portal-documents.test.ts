// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { storedDocumentPdfName } from "@carbon/files";
import { afterAll, beforeAll, describe, expect, vi } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { postgrestTest } from "./fixtures/local-supabase";

vi.hoisted(() => {
  process.env.CARBON_EDITION = "enterprise";
});

const { getCustomerPortalOverview, resolveCustomerPortalDocument } = await import(
  "../../app/modules/sales/sales.service"
);

let f: Fixture;
let other: Fixture;
let validOrderId: string;
let draftOrderId: string;
let arbitraryOrderId: string;
let validPath: string;
let validReleaseId: string;
let arbitraryReleaseId: string;

beforeAll(async () => {
  if (!hasLocalDatabase) return;
  f = await alwaysPostFixture();
  other = await alwaysPostFixture();
  const opportunityId = `${f.prefix}-portal-opportunity`;
  validOrderId = `${f.prefix}-valid-order`;
  draftOrderId = `${f.prefix}-draft-order`;
  arbitraryOrderId = `${f.prefix}-arbitrary-order`;
  const validName = storedDocumentPdfName("PORTAL-VALID", "2026-11-12T12:00:00Z");
  const draftName = storedDocumentPdfName("PORTAL-DRAFT", "2026-11-12T12:00:00Z");
  const arbitraryName = storedDocumentPdfName(
    "PORTAL-ARBITRARY",
    "2026-11-12T12:00:00Z"
  );
  validPath = `${f.companyId}/opportunity/${opportunityId}/${validName}`;
  const draftPath = `${f.companyId}/opportunity/${opportunityId}/${draftName}`;
  const arbitraryPath = `${f.companyId}/job/another-job/${arbitraryName}`;

  await seed(f, async (trx) => {
    await trx
      .insertInto("opportunity")
      .values({ id: opportunityId, companyId: f.companyId, customerId: f.customerId })
      .execute();
    await trx
      .insertInto("salesOrder")
      .values([
        {
          id: validOrderId,
          salesOrderId: "PORTAL-VALID",
          status: "Confirmed",
          opportunityId,
          customerId: f.customerId,
          companyId: f.companyId,
          currencyCode: "USD",
          createdBy: USER
        },
        {
          id: draftOrderId,
          salesOrderId: "PORTAL-DRAFT",
          status: "Draft",
          opportunityId,
          customerId: f.customerId,
          companyId: f.companyId,
          currencyCode: "USD",
          createdBy: USER
        },
        {
          id: arbitraryOrderId,
          salesOrderId: "PORTAL-ARBITRARY",
          status: "Confirmed",
          opportunityId,
          customerId: f.customerId,
          companyId: f.companyId,
          currencyCode: "USD",
          createdBy: USER
        }
      ])
      .execute();
    await trx
      .insertInto("document")
      .values([
        {
          companyId: f.companyId,
          createdBy: USER,
          type: "PDF",
          name: validName,
          path: validPath,
          size: 1,
          sourceDocument: "Sales Order",
          sourceDocumentId: validOrderId
        },
        {
          companyId: f.companyId,
          createdBy: USER,
          type: "PDF",
          name: draftName,
          path: draftPath,
          size: 1,
          sourceDocument: "Sales Order",
          sourceDocumentId: draftOrderId
        },
        {
          companyId: f.companyId,
          createdBy: USER,
          type: "PDF",
          name: arbitraryName,
          path: arbitraryPath,
          size: 1,
          sourceDocument: "Sales Order",
          sourceDocumentId: arbitraryOrderId
        }
      ])
      .execute();
    const releases = await trx
      .insertInto("customerPortalDocument")
      .values([
        {
          companyId: f.companyId,
          customerId: f.customerId,
          salesOrderId: validOrderId,
          documentType: "CoC",
          documentPath: validPath,
          title: "Valid certificate",
          createdBy: USER
        },
        {
          companyId: f.companyId,
          customerId: f.customerId,
          salesOrderId: arbitraryOrderId,
          documentType: "CoC",
          documentPath: arbitraryPath,
          title: "Wrong folder",
          createdBy: USER
        }
      ])
      .returning("id")
      .execute();
    validReleaseId = releases[0].id;
    arbitraryReleaseId = releases[1].id;
  });
}, 120_000);

afterAll(async () => {
  if (!hasLocalDatabase) return;
  await other.cleanup();
  await f.cleanup();
}, 120_000);

describe("customer portal typed PDF resolver", () => {
  postgrestTest("serves only an issued PDF for the owning customer", async (client) => {
    const owned = await resolveCustomerPortalDocument(
      client,
      { companyId: f.companyId, customerId: f.customerId },
      "acknowledgement",
      validOrderId
    );
    expect(owned?.path).toBe(validPath);

    const wrongCompany = await resolveCustomerPortalDocument(
      client,
      { companyId: other.companyId, customerId: f.customerId },
      "acknowledgement",
      validOrderId
    );
    expect(wrongCompany).toBeNull();

    const wrongCustomer = await resolveCustomerPortalDocument(
      client,
      { companyId: f.companyId, customerId: other.customerId },
      "acknowledgement",
      validOrderId
    );
    expect(wrongCustomer).toBeNull();
  });

  postgrestTest("refuses draft orders and a PDF outside the order folder", async (client) => {
    const scope = { companyId: f.companyId, customerId: f.customerId };
    expect(
      await resolveCustomerPortalDocument(client, scope, "acknowledgement", draftOrderId)
    ).toBeNull();
    expect(
      await resolveCustomerPortalDocument(client, scope, "acknowledgement", arbitraryOrderId)
    ).toBeNull();
  });

  postgrestTest("requires a released file to match its source folder", async (client) => {
    const scope = { companyId: f.companyId, customerId: f.customerId };
    expect(
      (await resolveCustomerPortalDocument(client, scope, "coc", validReleaseId))?.path
    ).toBe(validPath);
    expect(
      await resolveCustomerPortalDocument(client, scope, "coc", arbitraryReleaseId)
    ).toBeNull();
    expect(
      await resolveCustomerPortalDocument(
        client,
        { companyId: f.companyId, customerId: other.customerId },
        "coc",
        validReleaseId
      )
    ).toBeNull();
  });

  postgrestTest("lists a released shipment document without a packing slip", async (client) => {
    const shipmentId = `${f.prefix}-released-shipment`;
    const documentName = "inspection-certificate.pdf";
    const documentPath = `${f.companyId}/opportunity/${f.prefix}-portal-opportunity/${documentName}`;
    await f.db.insertInto("shipment").values({
      id: shipmentId,
      shipmentId,
      sourceDocument: "Sales Order",
      sourceDocumentId: validOrderId,
      customerId: f.customerId,
      status: "Posted",
      postingDate: f.today,
      trackingNumber: "TRACK-123",
      companyId: f.companyId,
      createdBy: USER
    }).execute();
    await f.db.insertInto("document").values({
      companyId: f.companyId,
      createdBy: USER,
      type: "PDF",
      name: documentName,
      path: documentPath,
      size: 1,
      sourceDocument: "Shipment",
      sourceDocumentId: shipmentId
    }).execute();
    const release = await f.db.insertInto("customerPortalDocument").values({
      companyId: f.companyId,
      customerId: f.customerId,
      shipmentId,
      documentType: "CoC",
      documentPath,
      title: "Inspection certificate",
      createdBy: USER
    }).returning("id").executeTakeFirstOrThrow();

    const overview = await getCustomerPortalOverview(
      client,
      { companyId: f.companyId, customerId: f.customerId },
      { section: "shipments" }
    );
    expect(overview.error).toBeNull();
    expect(overview.data?.shipments).toContainEqual(expect.objectContaining({
      id: shipmentId,
      hasPdf: false,
      trackingNumber: "TRACK-123"
    }));
    expect(overview.data?.releasedDocuments).toContainEqual(expect.objectContaining({
      id: release.id,
      shipmentId
    }));
  });
});
