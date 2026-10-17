// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

import {
  alwaysPostFixture,
  expectPostedJournals,
  expectProvisionalJournals,
  type Fixture,
  jobFixture,
  journalLinesOf,
  newJournals,
  stampCutover,
  stockPart,
  unwrap
} from "./fixtures/always-post";
import { issueMaterial as issue } from "../../app/modules/inventory/inventory.service";
import { databaseTest } from "./fixtures/local-database";
import { expect } from "vitest";
import { closeJob } from "../../app/modules/production/production.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import { handlesOf } from "./fixtures/handles";

/** Issues the job's two parts to its operation by hand. */
async function issueTwoParts(
  f: Fixture,
  job: Awaited<ReturnType<typeof jobFixture>>
) {
  unwrap(
    await invokePosting(handlesOf(f.ctx), "issue", {
            type: "partToOperation",
            id: job.operationId,
            itemId: f.partId,
            materialId: job.materialId,
            quantity: 2,
            adjustmentType: "Negative Adjmt."
          }, issue)
  );
}

databaseTest(
  "close-job writes a Provisional variance before the cutover and a Posted one after it",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);

      // Before the cutover: 20 of material in WIP, written off on close.
      const before = await jobFixture(f, "1");
      await issueTwoParts(f, before);
      const provisional = await newJournals(f, async () =>
        await closeJob(f.service, { jobId: before.jobId })
      );
      await expectProvisionalJournals(f, provisional, "Job Close");
      expect(await journalLinesOf(f, provisional)).toEqual([
        {
          accountId: f.account("filler"),
          amount: 20,
          accountDefaultRole: null,
          documentType: "Job Close"
        },
        {
          accountId: f.account("wip"),
          amount: -20,
          accountDefaultRole: null,
          documentType: "Job Close"
        }
      ]);

      // After the cutover: the same close posts in the current period.
      const periodId = await stampCutover(f);
      const after = await jobFixture(f, "2");
      await issueTwoParts(f, after);
      const posted = await newJournals(f, async () =>
        await closeJob(f.service, { jobId: after.jobId })
      );
      await expectPostedJournals(f, posted, "Job Close", periodId);
    } finally {
      await f.cleanup();
    }
  }
);
