// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Closing a rental agreement against the live database: a rental document
// still open refuses the close and names the document.

import { expect } from "vitest";
import { databaseTest } from "../fixtures/local-database";
import { postRentalAgreement as postRentalAgreement } from "../../../app/modules/sales/sales.service";
import { rentalFixture } from "../fixtures/rental";
import {
  invokePosting,
  invokeCreate
} from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
databaseTest(
  "an open rental receipt refuses the agreement's close",
  async () => {
    const f = await rentalFixture();
    try {
      await f.db
        .updateTable("rentalAgreementLine")
        .set({ status: "On Rent", deliveredAt: "2026-09-01" })
        .where("id", "=", f.lineIds[0]!)
        .where("companyId", "=", f.companyId)
        .execute();
      const receipt = await invokeCreate(handlesOf(f.ctx), {
        type: "receiptFromRentalAgreement",
        rentalAgreementId: f.agreementId
      });
      expect(receipt.error).toBeNull();

      const result = await invokePosting(
        handlesOf(f.ctx),
        "post-rental-agreement",
        {
          type: "close",
          rentalAgreementId: f.agreementId
        },
        postRentalAgreement
      );
      expect(result.error?.message).toContain("Receipt RCV-");
      expect(result.error?.message).toContain("is still open");
    } finally {
      await f.cleanup();
    }
  }
);
