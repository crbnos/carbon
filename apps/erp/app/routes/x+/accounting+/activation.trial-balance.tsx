// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { parseCsv } from "@carbon/files/csv";
import { validator } from "@carbon/form";
import { getErrorMessage, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { SetupBody, SetupSection } from "~/components/Setup";
import {
  openingTrialBalanceImportValidator,
  openingTrialBalanceValidator
} from "~/modules/accounting";
import {
  getActivationCutover,
  getMigrationClearing,
  saveOpeningTrialBalance
} from "~/modules/accounting/accounting.server";
import type { TrialBalanceImportResult } from "~/modules/accounting/ui/Activation";
import {
  ActivationFooter,
  MigrationClearingTable,
  TrialBalanceEditor
} from "~/modules/accounting/ui/Activation";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Trial Balance`,
  to: path.to.accountingActivationStep("trial-balance")
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });
  const { cutoverDate } = await getActivationCutover(
    client,
    companyId,
    request
  );
  const clearing = await getMigrationClearing(getDatabaseClient(), {
    companyId,
    cutoverDate
  });
  return {
    cutoverDate,
    trialBalance: clearing.trialBalance,
    controlAccountIds: [...clearing.controlAccountIds],
    clearing: { rows: clearing.rows, total: clearing.total }
  };
}

const CSV_COLUMNS = ["accountNumber", "debit", "credit"] as const;

/** A CSV amount: empty is zero; thousands separators are dropped. */
function parseAmount(value: unknown): number | null {
  const text = String(value ?? "")
    .replace(/,/g, "")
    .trim();
  if (text === "") return 0;
  const amount = Number(text);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** `save-tb` saves the editor's lines; `import-tb` replaces them with a CSV. */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, { update: "accounting" });

  const formData = await request.formData();
  const intent = formData.get("intent");
  const { pathname, search } = new URL(request.url);
  const backToStep = `${pathname}${search}`;
  const db = getDatabaseClient();

  if (intent === "save-tb") {
    const validation = await validator(openingTrialBalanceValidator).validate(
      formData
    );
    if (validation.error) {
      return data(
        {},
        await flash(
          request,
          error(
            validation.error,
            Object.values(validation.error.fieldErrors)[0] ??
              "Invalid trial balance"
          )
        )
      );
    }
    try {
      await saveOpeningTrialBalance(db, {
        companyId,
        userId,
        cutoverDate: validation.data.cutoverDate,
        lines: validation.data.lines
      });
    } catch (err) {
      return data(
        {},
        await flash(
          request,
          error(err, getErrorMessage(err, "Failed to save the trial balance"))
        )
      );
    }
    throw redirect(
      backToStep,
      await flash(request, success("Trial balance saved"))
    );
  }

  if (intent === "import-tb") {
    const validation = await validator(
      openingTrialBalanceImportValidator
    ).validate(formData);
    if (validation.error) {
      return data<TrialBalanceImportResult>(
        { errors: Object.values(validation.error.fieldErrors) },
        await flash(request, error(validation.error, "Invalid CSV"))
      );
    }

    const { rows, fields } = parseCsv<Record<string, unknown>>(
      validation.data.csv
    );
    const missing = CSV_COLUMNS.filter((column) => !fields.includes(column));
    const errors: string[] = [];
    if (missing.length > 0) {
      errors.push(`The CSV has no ${missing.join(", ")} column.`);
    }

    const parsed: { accountNumber: string; debit: number; credit: number }[] =
      [];
    if (missing.length === 0) {
      rows.forEach((row, index) => {
        const line = index + 2; // the header is line 1
        const accountNumber = String(row.accountNumber ?? "").trim();
        const debit = parseAmount(row.debit);
        const credit = parseAmount(row.credit);
        if (!accountNumber) {
          errors.push(`Line ${line} has no account number.`);
          return;
        }
        if (debit === null || credit === null) {
          errors.push(
            `Line ${line} (${accountNumber}) has a debit or credit that is not a positive number.`
          );
          return;
        }
        parsed.push({ accountNumber, debit, credit });
      });
    }

    const numbers = [...new Set(parsed.map((line) => line.accountNumber))];
    const accountIdByNumber = new Map<string, string>();
    if (numbers.length > 0) {
      const accounts = await client
        .from("account")
        .select("id, number")
        .eq("companyGroupId", companyGroupId)
        .eq("isGroup", false)
        .eq("active", true)
        .in("number", numbers);
      if (accounts.error) {
        return data<TrialBalanceImportResult>(
          { errors: ["Failed to read the chart of accounts."] },
          await flash(
            request,
            error(accounts.error, "Failed to read the chart of accounts")
          )
        );
      }
      for (const account of accounts.data ?? []) {
        if (account.number) accountIdByNumber.set(account.number, account.id);
      }
    }
    for (const accountNumber of numbers) {
      if (!accountIdByNumber.has(accountNumber)) {
        errors.push(
          `Account ${accountNumber} is not an active posting account.`
        );
      }
    }

    if (errors.length > 0) {
      return data<TrialBalanceImportResult>(
        { errors },
        await flash(request, error(null, "The CSV was not imported"))
      );
    }

    try {
      await saveOpeningTrialBalance(db, {
        companyId,
        userId,
        cutoverDate: validation.data.cutoverDate,
        lines: parsed.flatMap(({ accountNumber, debit, credit }) => {
          const accountId = accountIdByNumber.get(accountNumber);
          return accountId && (debit !== 0 || credit !== 0)
            ? [{ accountId, debit, credit }]
            : [];
        })
      });
    } catch (err) {
      return data<TrialBalanceImportResult>(
        {},
        await flash(
          request,
          error(err, getErrorMessage(err, "Failed to save the trial balance"))
        )
      );
    }
    throw redirect(
      backToStep,
      await flash(request, success("Trial balance imported"))
    );
  }

  return data(
    {},
    await flash(request, error(intent, "Unknown trial balance action"))
  );
}

/** Step 4: the prior system's trial balance, and Migration Clearing. */
export default function AccountingActivationTrialBalanceRoute() {
  const { cutoverDate, trialBalance, controlAccountIds, clearing } =
    useLoaderData<typeof loader>();

  return (
    <>
      <SetupBody>
        <SetupSection
          title={<Trans>Trial Balance</Trans>}
          description={
            <Trans>
              Enter the prior system's trial balance as of the day before the
              cutover, for every account.
            </Trans>
          }
        >
          <TrialBalanceEditor
            cutoverDate={cutoverDate}
            lines={trialBalance}
            controlAccountIds={controlAccountIds}
          />
        </SetupSection>
        <SetupSection
          title={<Trans>Migration Clearing</Trans>}
          description={
            <Trans>
              On a control account, Carbon opens the balance from its own open
              items, inventory and fixed assets. The trial balance must agree:
              every difference stays on Migration Clearing, which must total
              zero.
            </Trans>
          }
        >
          <MigrationClearingTable rows={clearing.rows} total={clearing.total} />
        </SetupSection>
      </SetupBody>
      <ActivationFooter step="trial-balance" cutoverDate={cutoverDate} />
    </>
  );
}
