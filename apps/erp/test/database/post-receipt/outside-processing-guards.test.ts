// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What an outside processing order refuses: a receipt for a Closed job, a
// close while it is still to receive, and a job whose cost is its project's.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { CarbonError } from "@carbon/api/service-fn.server";
import { expect } from "vitest";
import { postAssetTransfer } from "../../../app/modules/accounting/accounting.service";
import { postReceipt } from "../../../app/modules/inventory/inventory.service";
import { closeJob } from "../../../app/modules/production/production.server";
import { lineOperationJob } from "../../../app/modules/purchasing/purchasing.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  jobFixture,
  seed,
  USER
} from "../fixtures/always-post";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { operationContext, postgrestTest } from "../fixtures/local-supabase";
import {
  assetUnderConstruction,
  completeJob,
  draftReceipt,
  jobReceived,
  operation,
  outsideProcessingOrder,
  receive,
  wipAccount
} from "../fixtures/outside-processing";

databaseTest(
  "a closed job refuses an outside processing receipt",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f);
      await completeJob(f, order.jobId);
      await seed(f, (trx) =>
        trx
          .updateTable("job")
          .set({ status: "Closed" })
          .where("id", "=", order.jobId)
          .where("companyId", "=", f.companyId)
          .execute()
      );

      const receiptId = await draftReceipt(f, order.purchaseOrderId, 10);
      const { error } = await invokePosting(
        handlesOf(f.ctx),
        "post-receipt",
        { type: "post", receiptId },
        postReceipt
      );

      // The close wrote the job's WIP off once; this cost would stay in WIP.
      expect(error?.status).toBe(400);
      expect(await wipAccount(f)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "a job cannot be closed while its outside processing is still to receive",
  async (serviceRole) => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f, { thenInHouse: true });
      const ctx = operationContext(f, serviceRole, USER);
      const notCompleted = await closeJob(ctx, { jobId: order.jobId });
      expect(notCompleted.error?.category).toBe("rule");
      expect((await jobReceived(f, order.jobId)).status).toBe("In Progress");

      await receive(f, order.purchaseOrderId, 6);
      await completeJob(f, order.jobId);

      const refused = await closeJob(ctx, { jobId: order.jobId });
      expect(refused.error?.category).toBe("rule");
      expect((await jobReceived(f, order.jobId)).status).toBe("Completed");

      // The rest comes in after the completion, so the close writes it off.
      await receive(f, order.purchaseOrderId, 4);
      const closed = await closeJob(ctx, { jobId: order.jobId });
      expect(closed).toEqual({
        data: { jobId: order.jobId, status: "Closed", warning: null },
        error: null
      });
      expect((await jobReceived(f, order.jobId)).status).toBe("Closed");
      expect(await wipAccount(f)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a job that consumes to its project cannot be attached to an asset under construction",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f, { thenInHouse: true });
      const assetId = await assetUnderConstruction(f);
      await seed(f, async (trx) => {
        const project = await trx
          .insertInto("project")
          .values({
            name: "Contract",
            status: "Released",
            costTreatment: "Expense",
            companyId: f.companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .updateTable("job")
          .set({ projectId: project.id, consumeToProject: true })
          .where("id", "=", order.jobId)
          .where("companyId", "=", f.companyId)
          .execute();
      });

      const { error } = await invokePosting(
        handlesOf(f.ctx),
        "post-asset-transfer",
        { type: "attachJob", fixedAssetId: assetId, jobId: order.jobId },
        postAssetTransfer
      );

      expect(error?.status).toBe(400);
      const asset = await f.db
        .selectFrom("fixedAsset")
        .select("acquisitionCost")
        .where("id", "=", assetId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(asset.acquisitionCost).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "a purchase order line sent with only an operation takes the operation's job",
  async (serviceRole) => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f);
      const other = await jobFixture(f, "other");
      const ctx = operationContext(f, serviceRole, USER);

      // The job keeps the receipt's cost once the operation is deleted.
      expect(
        await lineOperationJob(ctx, { jobOperationId: order.operationId })
      ).toBe(order.jobId);
      const refusal = await lineOperationJob(ctx, {
        jobId: other.jobId,
        jobOperationId: order.operationId
      });
      expect(refusal instanceof CarbonError && refusal.category).toBe(
        "validation"
      );
    } finally {
      await f.cleanup();
    }
  }
);
