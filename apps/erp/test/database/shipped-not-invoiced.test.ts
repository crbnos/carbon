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
  "keeps later and partially billed shipments in the close warning until their quantity is billed",
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
      });
    } finally {
      await db.destroy();
    }
  }
);
