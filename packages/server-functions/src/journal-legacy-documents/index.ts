// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Writes the missing journals of legacy documents after the enable
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 5a). A company enabled
// before the enable wrote them (step 1a) still has posted documents dated on
// or after its cutover with no journal, and a payment against one fails with
// "Target is missing its original control account". The enable is one-way,
// so this runs its step 1a again, in one transaction: the same builders,
// except that an outbound FIFO or LIFO movement with no cost row relieves the
// layers open now (there is no re-cost after the enable to value it). The
// journals it wrote then get their periods, their stand-in lines re-pointed
// and are promoted to Posted, scoped to those journals by id. A journal dated
// in a Closed or Locked period refuses the whole call, naming the period,
// before any journal is written (`insertProvisionalJournals`).

import { getLogger } from "@carbon/logger";
import { sql } from "kysely";
import { z } from "zod";
import {
  journalLegacyDocuments,
  type LegacyJournalCounts
} from "../activate-accounting/legacy";
import {
  assignPeriods,
  promoteJournals,
  repointStandInLines
} from "../activate-accounting/promote";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import { getCurrentAccountingPeriod } from "../lib/get-accounting-period";

const logger = getLogger("server-functions", "journal-legacy-documents");

export const journalLegacyDocumentsInput = z.object({});

export type JournalLegacyDocumentsResult = {
  /** The legacy documents that got their journal, per family. */
  legacyJournals: LegacyJournalCounts;
};

export const ACCOUNTING_NOT_SET_UP = "Set up accounting first.";

const journalLegacyDocumentsFn = defineServerFn({
  name: "journal-legacy-documents",
  input: journalLegacyDocumentsInput,
  permissions: { update: "accounting" },
  async run({ db, companyId, userId }): Promise<JournalLegacyDocumentsResult> {
    return db
      .transaction()
      .execute(async (trx): Promise<JournalLegacyDocumentsResult> => {
        // Every posting reads this row FOR SHARE, so no posting writes a
        // journal while this runs.
        const settings = await trx
          .selectFrom("companySettings")
          .select(
            sql<string | null>`"accountingCutoverDate"::text`.as("cutover")
          )
          .where("id", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        if (!settings) {
          logger.warn("Company settings not found", { companyId });
          throw new NotFoundError("Company settings not found");
        }
        const cutoverDate = settings.cutover;
        if (!cutoverDate) {
          logger.warn("Refused: accounting is not set up", { companyId });
          throw new InvalidInputError(ACCOUNTING_NOT_SET_UP);
        }

        // After the enable every posting writes Posted, so a Provisional
        // journal this transaction did not find here is one it wrote.
        const provisional = () =>
          trx
            .selectFrom("journal")
            .select("id")
            .where("companyId", "=", companyId)
            .where("status", "=", "Provisional")
            .execute();
        const before = new Set((await provisional()).map((row) => row.id));

        const legacyJournals = await journalLegacyDocuments(trx, {
          companyId,
          userId,
          cutoverDate,
          outboundCosting: "open-layers"
        });

        const journalIds = (await provisional())
          .map((row) => row.id)
          .filter((id) => !before.has(id));
        if (journalIds.length === 0) return { legacyJournals };
        const scope = { journalIds };

        await assignPeriods(trx, companyId, scope);
        const defaults = await trx
          .selectFrom("accountDefault")
          .selectAll()
          .where("companyId", "=", companyId)
          .executeTakeFirstOrThrow();
        await repointStandInLines(trx, companyId, scope, defaults);
        await promoteJournals(trx, companyId, userId, scope);

        // The period that holds today Active, as the enable leaves it.
        await getCurrentAccountingPeriod(companyId, trx);

        logger.info("Wrote the journals of legacy documents", {
          companyId,
          journals: journalIds.length,
          legacyJournals
        });
        return { legacyJournals };
      });
  }
});

export default journalLegacyDocumentsFn;
