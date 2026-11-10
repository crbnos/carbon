// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { getShippedNotInvoiced } from "../../app/modules/accounting/accounting.service";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";

databaseTest(
  "warns only for net shipments whose quantity remains uninvoiced, including fixed assets",
  async () => {
    const db = await connectLocalTestDatabase();
    try {
      await db.transaction().execute(async (trx) => {
        // Temporary relations exercise the production read without changing company data.
        await sql`CREATE TEMP TABLE shipment (id text, "companyId" text, "shipmentId" text, status text, "sourceDocument" text, "postingDate" date) ON COMMIT DROP`.execute(
          trx
        );
        await sql`CREATE TEMP TABLE "shipmentLine" (id text, "shipmentId" text, "companyId" text, "lineId" text, "shippedQuantity" numeric) ON COMMIT DROP`.execute(
          trx
        );
        await sql`CREATE TEMP TABLE "salesInvoice" (id text, "companyId" text, status text, "postingDate" date) ON COMMIT DROP`.execute(
          trx
        );
        await sql`CREATE TEMP TABLE "salesInvoiceLine" (id text, "invoiceId" text, "companyId" text, "salesOrderLineId" text, quantity numeric) ON COMMIT DROP`.execute(
          trx
        );
        await sql`CREATE TEMP TABLE "shipmentFixedAssetLine" ("shipmentId" text, "companyId" text, "salesOrderLineId" text, shipped boolean) ON COMMIT DROP`.execute(trx);
        await sql`CREATE TEMP TABLE "salesReturnOrderLine" (id text, "companyId" text, "shipmentLineId" text, "salesInvoiceLineId" text, "returnType" text) ON COMMIT DROP`.execute(trx);
        await sql`CREATE TEMP TABLE "receiptLine" ("receiptId" text, "companyId" text, "lineId" text, "receivedQuantity" numeric) ON COMMIT DROP`.execute(trx);
        await sql`CREATE TEMP TABLE receipt (id text, "companyId" text, status text, "sourceDocument" text, "postingDate" date) ON COMMIT DROP`.execute(trx);
        await sql`INSERT INTO shipment VALUES ('oct', 'c', 'SH01', 'Posted', 'Sales Order', '2026-10-01'), ('nov', 'c', 'SH02', 'Posted', 'Sales Order', '2026-11-01')`.execute(
          trx
        );
        await sql`INSERT INTO "shipmentLine" VALUES ('oct-line', 'oct', 'c', 'order-line', 5), ('nov-line', 'nov', 'c', 'order-line', 5)`.execute(
          trx
        );
        await sql`INSERT INTO "salesInvoice" VALUES ('oct-invoice', 'c', 'Submitted', '2026-10-01'), ('nov-invoice', 'c', 'Draft', '2026-11-01'), ('dec-invoice', 'c', 'Submitted', '2026-12-01'), ('other-company', 'other', 'Submitted', '2026-11-01')`.execute(
          trx
        );
        await sql`INSERT INTO "salesInvoiceLine" VALUES ('oct-billed', 'oct-invoice', 'c', 'order-line', 5), ('nov-billed', 'nov-invoice', 'c', 'order-line', 3), ('dec-billed', 'dec-invoice', 'c', 'order-line', 50), ('other-billed', 'other-company', 'other', 'order-line', 50)`.execute(
          trx
        );
        const read = () =>
          getShippedNotInvoiced(trx, "c", "2026-11-01", "2026-11-30");
        const warning = {
          failing: true,
          count: 1,
          documents: [
            {
              documentType: "Shipment",
              id: "nov",
              readableId: "SH02",
              status: "Posted"
            }
          ]
        };
        expect(await read()).toEqual(warning);
        // The first shipment is fully billed; a later shipment cannot reopen it.
        expect(await getShippedNotInvoiced(trx, "c", "2026-10-01", "2026-11-30")).toEqual(warning);

        await sql`UPDATE "salesInvoice" SET status = 'Submitted' WHERE id = 'nov-invoice'`.execute(
          trx
        );
        expect(await read()).toEqual(warning);
        await sql`UPDATE "salesInvoiceLine" SET quantity = 5 WHERE id = 'nov-billed'`.execute(
          trx
        );
        expect(await read()).toEqual({
          failing: false,
          count: 0,
          documents: []
        });
        await sql`UPDATE "salesInvoice" SET status = 'Voided' WHERE id = 'nov-invoice'`.execute(
          trx
        );
        expect(await read()).toEqual(warning);
        await sql`INSERT INTO "salesReturnOrderLine" VALUES ('return', 'c', 'nov-line', NULL, 'Return to Stock')`.execute(trx);
        await sql`INSERT INTO receipt VALUES ('return-receipt', 'c', 'Posted', 'Sales Return Order', '2026-11-20')`.execute(trx);
        await sql`INSERT INTO "receiptLine" VALUES ('return-receipt', 'c', 'return', 5)`.execute(trx);
        expect(await read()).toEqual({ failing: false, count: 0, documents: [] });
        await sql`UPDATE "salesReturnOrderLine" SET "returnType" = 'Return for Service'`.execute(trx);
        expect(await read()).toEqual(warning);
        await sql`UPDATE "salesReturnOrderLine" SET "returnType" = 'Return to Stock'`.execute(trx);
        await sql`UPDATE receipt SET "postingDate" = '2026-12-01'`.execute(trx);
        expect(await read()).toEqual(warning);
        await sql`UPDATE receipt SET "postingDate" = '2026-11-20'`.execute(trx);
        await sql`INSERT INTO shipment VALUES ('asset', 'c', 'SH03', 'Posted', 'Sales Order', '2026-11-10')`.execute(trx);
        await sql`INSERT INTO "shipmentFixedAssetLine" VALUES ('asset', 'c', 'asset-order-line', true)`.execute(trx);
        expect(await read()).toEqual({ failing: true, count: 1, documents: [{ documentType: 'Shipment', id: 'asset', readableId: 'SH03', status: 'Posted' }] });
        await sql`INSERT INTO "salesInvoiceLine" VALUES ('asset-billed', 'oct-invoice', 'c', 'asset-order-line', 1)`.execute(trx);
        expect(await read()).toEqual({ failing: false, count: 0, documents: [] });
        // Shipments on the same date are covered in id order, once per shipment.
        await sql`INSERT INTO shipment VALUES ('tie-a', 'c', 'SH04', 'Posted', 'Sales Order', '2026-11-15'), ('tie-b', 'c', 'SH05', 'Posted', 'Sales Order', '2026-11-15')`.execute(trx);
        await sql`INSERT INTO "shipmentLine" VALUES ('tie-a-line', 'tie-a', 'c', 'tie-order-line', 5), ('tie-b-line', 'tie-b', 'c', 'tie-order-line', 5), ('tie-b-extra', 'tie-b', 'c', 'extra-order-line', 1)`.execute(trx);
        await sql`INSERT INTO "salesInvoiceLine" VALUES ('tie-billed', 'oct-invoice', 'c', 'tie-order-line', 5)`.execute(trx);
        expect(await read()).toEqual({ failing: true, count: 1, documents: [{ documentType: 'Shipment', id: 'tie-b', readableId: 'SH05', status: 'Posted' }] });
        await sql`INSERT INTO "salesInvoiceLine" VALUES ('tie-remainder', 'oct-invoice', 'c', 'tie-order-line', 5), ('extra-billed', 'oct-invoice', 'c', 'extra-order-line', 1)`.execute(trx);
        expect(await read()).toEqual({ failing: false, count: 0, documents: [] });
      });
    } finally {
      await db.destroy();
    }
  }
);
