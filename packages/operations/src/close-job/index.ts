import { datetime, getCompanyTimeZone } from "@carbon/database/datetime";
import {
  credit,
  debit,
  getCurrentAccountingPeriod,
  getDefaultPostingGroup,
  journalReference
} from "@carbon/database/posting";
import { getNextSequence } from "@carbon/database/sequence";
import { round } from "@carbon/utils";
import { nanoid } from "nanoid";
import { z } from "zod";
import { assertOperationPermissions, type OperationContext } from "../context";
import { runOperation } from "../result";

export const closeJobInput = z.object({
  jobId: z.string()
});

/**
 * Closing a job writes off whatever is left in WIP for it as production
 * variance, so the job's WIP nets to zero. Nothing to do when accounting is off
 * or the residual is under a cent.
 */
export function closeJob(
  ctx: OperationContext,
  input: z.infer<typeof closeJobInput>
) {
  return runOperation("close-job", async () => {
    const { jobId } = closeJobInput.parse(input);
    const { client, db, companyId, userId } = ctx;
    await assertOperationPermissions(ctx, { update: "production" });

    const today = datetime
      .today(await getCompanyTimeZone(client, companyId))
      .toString();

    const [accountingSettings, companyRecord] = await Promise.all([
      client
        .from("companySettings")
        .select("accountingEnabled")
        .eq("id", companyId)
        .single(),
      client
        .from("company")
        .select("companyGroupId")
        .eq("id", companyId)
        .single()
    ]);

    const accountingEnabled =
      accountingSettings.data?.accountingEnabled ?? false;

    if (!accountingEnabled) {
      return { success: true };
    }

    if (companyRecord.error) throw new Error("Failed to fetch company");

    const accountDefaults = await getDefaultPostingGroup(client, companyId);
    if (accountDefaults?.error || !accountDefaults?.data) {
      throw new Error("Error getting account defaults");
    }

    await db.transaction().execute(async (trx) => {
      const wipBalance = await trx
        .selectFrom("journalLine")
        .innerJoin("journal", "journal.id", "journalLine.journalId")
        .select((eb) => eb.fn.sum("journalLine.amount").as("balance"))
        .where(
          "journalLine.accountId",
          "=",
          accountDefaults.data!.workInProgressAccount
        )
        .where("journalLine.documentId", "=", jobId)
        .where("journal.companyId", "=", companyId)
        .executeTakeFirst();

      const remainingWip = Number(wipBalance?.balance ?? 0);

      if (Math.abs(remainingWip) < 0.01) return;

      const job = await trx
        .selectFrom("job")
        .where("id", "=", jobId)
        .where("companyId", "=", companyId)
        .select(["jobId", "itemId", "locationId"])
        .executeTakeFirstOrThrow();

      // Resolve the item dimensions so the WIP variance lines are attributable
      // to the finished good (mirrors the WIP lines posted during completion).
      const companyGroupId = companyRecord.data.companyGroupId;
      const dimensionMap = new Map<string, string>();
      if (companyGroupId) {
        const dimensions = await trx
          .selectFrom("dimension")
          .select(["id", "entityType"])
          .where("companyGroupId", "=", companyGroupId)
          .where("active", "=", true)
          .where("entityType", "in", ["ItemPostingGroup", "Item", "Location"])
          .execute();
        for (const dim of dimensions) {
          if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
        }
      }

      const finishedItemCost = job.itemId
        ? await trx
            .selectFrom("itemCost")
            .select(["itemPostingGroupId"])
            .where("itemId", "=", job.itemId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
        : null;

      const journalLineReference = nanoid();

      const journalLineInserts = [
        {
          accountId: accountDefaults.data!.materialVarianceAccount,
          description: "Production Variance",
          // Signed: a positive residual debits variance / credits WIP; a
          // negative (over-credited) residual reverses — always zeroing WIP.
          amount: round(debit("expense", remainingWip)),
          quantity: 0,
          documentType: "Job Close" as const,
          documentId: jobId,
          documentLineReference: journalReference.to.job(jobId),
          journalLineReference,
          companyId
        },
        {
          accountId: accountDefaults.data!.workInProgressAccount,
          description: "WIP Account",
          amount: round(credit("asset", remainingWip)),
          quantity: 0,
          documentType: "Job Close" as const,
          documentId: jobId,
          documentLineReference: journalReference.to.job(jobId),
          journalLineReference,
          companyId
        }
      ];

      const accountingPeriodId = await getCurrentAccountingPeriod(
        client,
        companyId,
        trx,
        today
      );

      const journalEntryId = await getNextSequence(
        trx,
        "journalEntry",
        companyId
      );

      const journalResult = await trx
        .insertInto("journal")
        .values({
          journalEntryId,
          accountingPeriodId,
          description: `Job Close Variance ${job.jobId}`,
          postingDate: today,
          companyId,
          sourceType: "Job Close",
          status: "Posted",
          postedAt: datetime.timestamp(),
          postedBy: userId,
          createdBy: userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      const journalLineResults = await trx
        .insertInto("journalLine")
        .values(
          journalLineInserts.map((line) => ({
            ...line,
            journalId: journalResult.id
          }))
        )
        .returning(["id"])
        .execute();

      if (dimensionMap.size > 0) {
        const dimensionInserts: {
          journalLineId: string;
          dimensionId: string;
          valueId: string;
          companyId: string;
        }[] = [];

        for (const jl of journalLineResults) {
          if (job.itemId && dimensionMap.has("Item")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Item")!,
              valueId: job.itemId,
              companyId
            });
          }
          if (
            finishedItemCost?.itemPostingGroupId &&
            dimensionMap.has("ItemPostingGroup")
          ) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("ItemPostingGroup")!,
              valueId: finishedItemCost.itemPostingGroupId,
              companyId
            });
          }
          if (job.locationId && dimensionMap.has("Location")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Location")!,
              valueId: job.locationId,
              companyId
            });
          }
        }

        if (dimensionInserts.length > 0) {
          await trx
            .insertInto("journalLineDimension")
            .values(dimensionInserts)
            .execute();
        }
      }
    });

    return { success: true };
  });
}
