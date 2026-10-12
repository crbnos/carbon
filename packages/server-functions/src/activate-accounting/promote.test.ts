// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import { activationFixture, USER } from "./activation-test-fixture";
import { repointStandInLines } from "./promote";

class Rollback extends Error {}

// A sales invoice to a sister company posted before the cutover with an empty
// shipping revenue default: its shipping line stands in on retained
// earnings, and the elimination line the posting copied from it does too.
databaseTest(
  "re-pointing a stand-in line moves the intercompany elimination line copied from it",
  async () => {
    const f = await activationFixture();
    try {
      await f.db
        .transaction()
        .execute(async (trx) => {
          await trx
            .updateTable("accountDefault")
            .set({ salesShippingRevenueAccount: f.account("shipping-revenue") })
            .where("companyId", "=", f.companyId)
            .execute();
          const journal = await trx
            .insertInto("journal")
            .values({
              journalEntryId: `${f.prefix}-JE-IC`,
              description: "Sales Invoice INV-IC",
              postingDate: f.today,
              sourceType: "Sales Invoice",
              status: "Provisional",
              accountingPeriodId: null,
              companyId: f.companyId,
              createdBy: USER
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          const line = await trx
            .insertInto("journalLine")
            .values({
              journalId: journal.id,
              accountId: f.account("retained-earnings"),
              accountDefaultRole: "salesShippingRevenueAccount",
              description: "Shipping Revenue",
              amount: 15,
              quantity: 1,
              documentType: "Invoice",
              documentId: `${f.prefix}-invoice-ic`,
              journalLineReference: "ic-shipping",
              companyId: f.companyId,
              createdBy: USER
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          const transaction = await trx
            .insertInto("intercompanyTransaction")
            .values({
              companyGroupId: f.groupId,
              sourceCompanyId: f.companyId,
              targetCompanyId: f.companyId,
              sourceJournalLineId: line.id,
              amount: 15,
              currencyCode: "USD",
              status: "Unmatched"
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          const elimination = await trx
            .insertInto("intercompanyEliminationLine")
            .values({
              intercompanyTransactionId: transaction.id,
              role: "Revenue",
              journalLineId: line.id,
              accountId: f.account("retained-earnings"),
              amount: 15,
              companyId: f.companyId,
              createdBy: USER
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          const defaults = await trx
            .selectFrom("accountDefault")
            .selectAll()
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow();

          await repointStandInLines(
            trx,
            f.companyId,
            { journalIds: [journal.id] },
            defaults
          );

          expect(
            await trx
              .selectFrom("journalLine")
              .select(["accountId", "accountDefaultRole"])
              .where("id", "=", line.id)
              .executeTakeFirstOrThrow()
          ).toEqual({
            accountId: f.account("shipping-revenue"),
            accountDefaultRole: null
          });
          expect(
            (
              await trx
                .selectFrom("intercompanyEliminationLine")
                .select("accountId")
                .where("id", "=", elimination.id)
                .executeTakeFirstOrThrow()
            ).accountId
          ).toBe(f.account("shipping-revenue"));
          throw new Rollback();
        })
        .catch((error) => {
          if (!(error instanceof Rollback)) throw error;
        });
    } finally {
      await f.cleanup();
    }
  }
);
