// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  getMigrationClearing,
  saveOpeningTrialBalance
} from "@carbon/database/accounting-cutover-reads";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
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
import { getActivationCutover } from "~/modules/accounting/accounting.server";
import {
  mapTrialBalanceAccounts,
  parseTrialBalanceCsv
} from "~/modules/accounting/trial-balance-csv";
import {
  ActivationFooter,
  MigrationClearingTable,
  TrialBalanceEditor,
  type TrialBalanceImportResult
} from "~/modules/accounting/ui/Activation";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "accounting/activation/trial-balance");

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
      logger.error("Failed to save the trial balance", {
        companyId,
        error: err
      });
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
        { errors: [{ code: "empty-file" }] },
        await flash(request, error(validation.error, "Invalid CSV"))
      );
    }

    const parsed = parseTrialBalanceCsv(validation.data.csv);
    if (parsed.errors) {
      return data<TrialBalanceImportResult>(
        { errors: parsed.errors },
        await flash(request, error(null, "The CSV was not imported"))
      );
    }

    const numbers = [...new Set(parsed.rows.map((row) => row.accountNumber))];
    const accounts =
      numbers.length > 0
        ? await client
            .from("account")
            .select("id, number")
            .eq("companyGroupId", companyGroupId)
            .eq("isGroup", false)
            .eq("active", true)
            .in("number", numbers)
        : { data: [], error: null };
    if (accounts.error) {
      logger.error("Failed to read the chart of accounts", {
        companyId,
        error: accounts.error
      });
      return data<TrialBalanceImportResult>(
        {},
        await flash(
          request,
          error(accounts.error, "Failed to read the chart of accounts")
        )
      );
    }
    const mapped = mapTrialBalanceAccounts(
      parsed.rows,
      new Map(
        (accounts.data ?? []).flatMap((account) =>
          account.number ? [[account.number, account.id] as const] : []
        )
      )
    );
    if (mapped.errors) {
      return data<TrialBalanceImportResult>(
        { errors: mapped.errors },
        await flash(request, error(null, "The CSV was not imported"))
      );
    }

    try {
      await saveOpeningTrialBalance(db, {
        companyId,
        userId,
        cutoverDate: validation.data.cutoverDate,
        lines: mapped.lines
      });
    } catch (err) {
      logger.error("Failed to save the imported trial balance", {
        companyId,
        error: err
      });
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
