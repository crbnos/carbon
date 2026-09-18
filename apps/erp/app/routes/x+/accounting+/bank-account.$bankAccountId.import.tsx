import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { z } from "zod";
import {
  importBankTransactionsFromCsv,
  matchBankTransactionsForAccount
} from "~/modules/accounting/accounting.ee.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const importPayloadValidator = z.object({
  fileName: z.string().min(1),
  rows: z
    .array(
      z.object({
        postedDate: z.string().min(1),
        amount: z.number(),
        description: z.string()
      })
    )
    .max(10000)
});

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const { bankAccountId } = params;
  if (!bankAccountId) throw notFound("bankAccountId not found");

  const payload = importPayloadValidator.safeParse(await request.json());
  if (!payload.success) {
    return data(
      {},
      await flash(request, error(payload.error, "Invalid import payload"))
    );
  }

  const { fileName, rows } = payload.data;

  try {
    const imported = await importBankTransactionsFromCsv(getDatabaseClient(), {
      companyBankAccountId: bankAccountId,
      companyId,
      userId,
      fileName,
      rows
    });

    const matchResult = await matchBankTransactionsForAccount(
      getDatabaseClient(),
      { companyBankAccountId: bankAccountId, companyId, userId }
    );

    return {
      transactionCount: imported.transactionCount,
      matched: matchResult.matched
    };
  } catch (err) {
    throw redirect(
      path.to.bankAccount(bankAccountId),
      await flash(request, error(err, "Failed to import bank statement"))
    );
  }
}
