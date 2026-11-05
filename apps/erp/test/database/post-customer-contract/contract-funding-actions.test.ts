// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import {
  deleteContractFunding,
  upsertContractFunding
} from "../../../app/modules/sales/sales.service";
import { databaseTest } from "../fixtures/local-database";
import { projectBillingTestFixture } from "../fixtures/project-billing";

const FUNDING = {
  modificationNumber: "P00001",
  fundedDate: "2026-10-01",
  acrn: "AA",
  fundedCost: 1000,
  fundedFee: 100
};

databaseTest(
  "funding actions change only on a Draft or Active contract",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      const project = await f.addProject("fa", "FA");
      const { contractId, lineId } = await f.addContract({
        key: "tm",
        projectId: project.projectId,
        projectElementId: project.rootId
      });
      const save = () =>
        upsertContractFunding(f.db, {
          ...FUNDING,
          customerContractLineId: lineId,
          companyId: f.companyId,
          userId: f.userId
        } as never);

      const { id } = await save();

      await f.db
        .updateTable("customerContract")
        .set({ status: "Ended" })
        .where("id", "=", contractId)
        .execute();

      await expect(save()).rejects.toThrow("Draft or Active");
      await expect(
        deleteContractFunding(f.db, {
          id,
          companyId: f.companyId,
          userId: f.userId
        })
      ).rejects.toThrow("Draft or Active");

      const rows = await f.db
        .selectFrom("customerContractFunding")
        .select("id")
        .where("customerContractLineId", "=", lineId)
        .execute();
      expect(rows).toEqual([{ id }]);
    } finally {
      await f.cleanup();
    }
  }
);
