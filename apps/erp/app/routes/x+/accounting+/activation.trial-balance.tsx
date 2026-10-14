// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import {
  isIgnorableOpenItem,
  isMigrationClearingZero,
  type OpenItem
} from "@carbon/database/accounting-cutover";
import {
  applyCarbonToOpeningTrialBalance,
  dayBeforeCutover,
  getMigrationClearing,
  saveOpeningTrialBalance,
  setCutoverInvoiceIgnored
} from "@carbon/database/accounting-cutover-reads";
import { debitSigned } from "@carbon/database/ledger";
import { getIntegrationIdsByRole, getIntegrationsByRole } from "@carbon/ee";
import {
  isTrialBalanceProvider,
  isTrialBalancePullError,
  type ProviderID,
  pullTrialBalanceFromProvider
} from "@carbon/ee/accounting";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getErrorMessage, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { SetupBody, SetupSection } from "~/components/Setup";
import {
  cutoverIgnoredInvoiceValidator,
  cutoverStepValidator,
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
  ApplyCarbonButton,
  type MigrationClearingItem,
  MigrationClearingTable,
  TrialBalanceEditor,
  type TrialBalanceImportResult,
  type TrialBalancePullResult
} from "~/modules/accounting/ui/Activation";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "accounting/activation/trial-balance");

/**
 * The company's active accounting integration, when it can provide a trial
 * balance. One accounting integration is active at a time.
 */
async function getTrialBalanceProvider(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{ id: ProviderID; name: string } | null> {
  const integrations = await client
    .from("companyIntegration")
    .select("id")
    .eq("companyId", companyId)
    .eq("active", true)
    .in("id", getIntegrationIdsByRole("accounting"));
  if (integrations.error) {
    logger.error("Failed to read the accounting integration", {
      companyId,
      error: integrations.error
    });
    return null;
  }
  const id = integrations.data
    ?.map((row) => row.id)
    .find(isTrialBalanceProvider);
  if (!id) return null;
  const config = getIntegrationsByRole("accounting").find(
    (integration) => integration.id === id
  );
  return { id, name: config?.name ?? id };
}

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
  const [clearing, provider] = await Promise.all([
    getMigrationClearing(getDatabaseClient(), { companyId, cutoverDate }),
    getTrialBalanceProvider(client, companyId)
  ]);
  return {
    cutoverDate,
    provider,
    trialBalance: clearing.trialBalance,
    controlAccountIds: [...clearing.controlAccountIds],
    clearing: {
      rows: clearing.rows,
      total: clearing.total,
      items: clearing.items.map((item) =>
        toClearingItem(item, clearing.settledFromCutoverIds)
      ),
      ignoredItems: clearing.ignoredItems.map((item) =>
        toClearingItem(item, clearing.settledFromCutoverIds)
      )
    }
  };
}

/** What Migration Clearing shows of an open item. */
function toClearingItem(
  item: OpenItem,
  settledFromCutoverIds: ReadonlySet<string>
): MigrationClearingItem {
  return {
    key: [
      item.openItemType,
      item.accountId,
      item.documentType,
      item.documentId,
      item.documentLineReference
    ].join("|"),
    accountId: item.accountId,
    openItemType: item.openItemType,
    documentType: item.documentType,
    documentId: item.documentId,
    label: item.reference ?? item.description,
    partyName: item.partyName ?? null,
    amount: debitSigned(item.accountClass, item.amount),
    ignorable: isIgnorableOpenItem(item, settledFromCutoverIds)
  };
}

/**
 * `save-tb` saves the editor's lines; `import-tb` replaces them with a CSV;
 * `pull-tb` replaces them with the connected accounting provider's;
 * `ignore-invoice` ignores an invoice on Migration Clearing or restores it;
 * `apply-carbon` sets the control accounts to Carbon's opening totals.
 */
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

  if (intent === "pull-tb") {
    const validation = await validator(cutoverStepValidator).validate(formData);
    if (validation.error) {
      return data<TrialBalancePullResult>(
        {},
        await flash(request, error(validation.error, "Invalid cutover date"))
      );
    }
    const provider = await getTrialBalanceProvider(client, companyId);
    if (!provider) {
      return data<TrialBalancePullResult>(
        {},
        await flash(
          request,
          error(null, "No connected accounting integration has a trial balance")
        )
      );
    }
    const { cutoverDate } = validation.data;
    try {
      const pulled = await pullTrialBalanceFromProvider(client, db, {
        companyId,
        providerId: provider.id,
        asOfDate: dayBeforeCutover(cutoverDate)
      });
      await saveOpeningTrialBalance(db, {
        companyId,
        userId,
        cutoverDate,
        lines: pulled.lines
      });
      const unplaced = [
        ...pulled.unmapped.map((row) => ({ ...row, ambiguous: false })),
        ...pulled.ambiguous.map((row) => ({ ...row, ambiguous: true }))
      ].map(({ code, name, amount, ambiguous }) => ({
        code,
        name,
        amount,
        ambiguous
      }));
      if (unplaced.length > 0) {
        // Saved, but some of the provider's balances have no Carbon account
        // yet: stay on the page so the editor can list them.
        return data<TrialBalancePullResult>(
          { unplaced },
          await flash(
            request,
            success(`Trial balance pulled from ${provider.name}`)
          )
        );
      }
    } catch (err) {
      logger.error("Failed to pull the trial balance", {
        companyId,
        provider: provider.id,
        error: err
      });
      return data<TrialBalancePullResult>(
        {},
        await flash(
          request,
          error(
            err,
            isTrialBalancePullError(err)
              ? err.message
              : getErrorMessage(err, "Failed to pull the trial balance")
          )
        )
      );
    }
    throw redirect(
      backToStep,
      await flash(
        request,
        success(`Trial balance pulled from ${provider.name}`)
      )
    );
  }

  if (intent === "ignore-invoice") {
    const validation = await validator(cutoverIgnoredInvoiceValidator).validate(
      formData
    );
    if (validation.error) {
      return data(
        {},
        await flash(request, error(validation.error, "Invalid invoice"))
      );
    }
    try {
      await setCutoverInvoiceIgnored(db, {
        companyId,
        userId,
        invoiceId: validation.data.invoiceId,
        ignored: validation.data.ignored
      });
    } catch (err) {
      logger.error("Failed to ignore the invoice", {
        companyId,
        invoiceId: validation.data.invoiceId,
        error: err
      });
      return data(
        {},
        await flash(
          request,
          error(err, getErrorMessage(err, "Failed to ignore the invoice"))
        )
      );
    }
    throw redirect(
      backToStep,
      await flash(
        request,
        success(
          validation.data.ignored ? "Invoice ignored" : "Invoice restored"
        )
      )
    );
  }

  if (intent === "apply-carbon") {
    const validation = await validator(cutoverStepValidator).validate(formData);
    if (validation.error) {
      return data(
        {},
        await flash(request, error(validation.error, "Invalid cutover date"))
      );
    }
    try {
      await applyCarbonToOpeningTrialBalance(db, {
        companyId,
        userId,
        cutoverDate: validation.data.cutoverDate
      });
    } catch (err) {
      logger.error("Failed to apply Carbon's totals to the trial balance", {
        companyId,
        error: err
      });
      return data(
        {},
        await flash(
          request,
          error(err, getErrorMessage(err, "Failed to update the trial balance"))
        )
      );
    }
    throw redirect(
      backToStep,
      await flash(request, success("Trial balance updated"))
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
  const { cutoverDate, provider, trialBalance, controlAccountIds, clearing } =
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
            // A new saved trial balance (a save, import, pull or apply)
            // drops what was typed over the old one.
            key={trialBalanceKey(trialBalance)}
            cutoverDate={cutoverDate}
            providerName={provider?.name ?? null}
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
              zero. Open an account to see its items, and ignore an invoice the
              prior system already settled.
            </Trans>
          }
          actions={
            <ApplyCarbonButton
              cutoverDate={cutoverDate}
              hasDifference={clearing.rows.some(
                (row) => !isMigrationClearingZero(row.difference)
              )}
            />
          }
        >
          <MigrationClearingTable
            cutoverDate={cutoverDate}
            rows={clearing.rows}
            total={clearing.total}
            items={clearing.items}
            ignoredItems={clearing.ignoredItems}
          />
        </SetupSection>
      </SetupBody>
      <ActivationFooter step="trial-balance" cutoverDate={cutoverDate} />
    </>
  );
}

/** Identifies a saved trial balance, so the editor remounts when it changes. */
function trialBalanceKey(
  lines: { accountId: string; debit: number; credit: number }[]
) {
  return lines
    .map((line) => `${line.accountId}:${line.debit}:${line.credit}`)
    .sort()
    .join("|");
}
