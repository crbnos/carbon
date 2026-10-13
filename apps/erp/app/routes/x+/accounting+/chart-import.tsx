// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Import a chart of accounts (.ai/specs/2026-10-12-chart-of-accounts-import.md)
// from two CSVs: the customer's chart, and the default accounts template
// filled with their account numbers. Both are required. `plan` shows what the
// files would do; `apply` runs the same plan in one transaction through the
// apply-account-import server function.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  type AccountImportResolutions,
  isApplicable,
  planAccountImport
} from "@carbon/database/account-import";
import { loadAccountImportContext } from "@carbon/database/account-import-reads";
import { getLogger } from "@carbon/logger";
import { Button } from "@carbon/react";
import { serverFns } from "@carbon/server-functions";
import { getErrorMessage, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuDownload } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, useFetcher } from "react-router";
import {
  SetupBody,
  SetupFooter,
  SetupFrame,
  SetupSection
} from "~/components/Setup";
import { useSettings } from "~/hooks";
import {
  parseChartCsv,
  parseDefaultsCsv
} from "~/modules/accounting/account-import-csv";
import { hasAccountingCutover } from "~/modules/accounting/accounting.utils";
import {
  type AccountImportAccount,
  AccountImportCsvErrors,
  AccountImportFileButton,
  AccountImportReview
} from "~/modules/accounting/ui/ChartOfAccounts";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "accounting/chart-import");

export const handle: Handle = {
  breadcrumb: msg`Import Chart of Accounts`,
  to: path.to.chartOfAccountsImport
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { update: "accounting" });
  return null;
}

function readResolutions(value: FormDataEntryValue | null) {
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    const targets: Record<string, number> = {};
    for (const [accountId, line] of Object.entries(parsed?.targets ?? {})) {
      if (typeof line === "number") targets[accountId] = line;
    }
    return { targets } satisfies AccountImportResolutions;
  } catch {
    return { targets: {} } satisfies AccountImportResolutions;
  }
}

const readFile = (value: FormDataEntryValue | null) => {
  const text = typeof value === "string" ? value : "";
  return text.trim() === "" ? null : text;
};

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, { update: "accounting" });

  const formData = await request.formData();
  const intent = formData.get("intent");
  const chartText = readFile(formData.get("chart"));
  const defaultsText = readFile(formData.get("defaults"));
  const chart = chartText ? parseChartCsv(chartText) : null;
  const defaults = defaultsText ? parseDefaultsCsv(defaultsText) : null;
  const files = {
    chart: chart && { errors: chart.errors, count: chart.rows?.length },
    defaults: defaults && {
      errors: defaults.errors,
      count: defaults.rows?.length
    }
  };
  // The plan needs both files: the chart says which accounts exist, the
  // defaults say which Carbon account each one is.
  if (!chart?.rows || !defaults?.rows) return { files };
  const resolutions = readResolutions(formData.get("resolutions"));

  if (intent === "apply") {
    const result = await serverFns
      .as({ client, db: getDatabaseClient(), companyId, userId })
      .invoke("apply-account-import", {
        chart: chart.rows,
        defaults: defaults.rows,
        resolutions
      });
    if (result.error) {
      logger.error("Failed to import the chart of accounts", {
        companyId,
        error: result.error
      });
      return data(
        { files, applyFailed: true },
        await flash(
          request,
          error(
            result.error,
            getErrorMessage(
              result.error,
              "Failed to import the chart of accounts"
            )
          )
        )
      );
    }
    const { counts } = result.data;
    throw redirect(
      path.to.chartOfAccounts,
      await flash(
        request,
        success(
          `Chart imported: ${counts.updated} updated, ${counts.created} new, ${counts.merged} merged, ${counts.deleted - counts.merged} deleted`
        )
      )
    );
  }

  try {
    const ctx = await loadAccountImportContext(
      getDatabaseClient(),
      companyGroupId,
      companyId
    );
    const plan = planAccountImport(chart.rows, defaults.rows, ctx, resolutions);
    const accounts: Record<string, AccountImportAccount> = {};
    for (const account of ctx.chart) {
      accounts[account.id] = { number: account.number, name: account.name };
    }
    return {
      files,
      review: {
        plan,
        rows: chart.rows,
        accounts,
        companies: ctx.companies
      }
    };
  } catch (err) {
    logger.error("Failed to plan the chart of accounts import", {
      companyId,
      error: err
    });
    return data(
      { files, planFailed: true },
      await flash(request, error(err, "Failed to read the chart of accounts"))
    );
  }
}

type UploadedFile = { name: string; text: string };

export default function ChartOfAccountsImportRoute() {
  const { t } = useLingui();
  const settings = useSettings();
  const planner = useFetcher<typeof action>();
  const applier = useFetcher<typeof action>();
  const [chart, setChart] = useState<UploadedFile | null>(null);
  const [defaults, setDefaults] = useState<UploadedFile | null>(null);
  const [targets, setTargets] = useState<Record<string, number>>({});

  const submitPlan = (
    nextChart: UploadedFile | null,
    nextDefaults: UploadedFile | null,
    nextTargets: Record<string, number>
  ) => {
    planner.submit(
      {
        intent: "plan",
        chart: nextChart?.text ?? "",
        defaults: nextDefaults?.text ?? "",
        resolutions: JSON.stringify({ targets: nextTargets })
      },
      { method: "post" }
    );
  };

  const onChart = (file: UploadedFile) => {
    setChart(file);
    setTargets({});
    submitPlan(file, defaults, {});
  };

  const onDefaults = (file: UploadedFile) => {
    setDefaults(file);
    setTargets({});
    submitPlan(chart, file, {});
  };

  const onTarget = (accountId: string, line: number | null) => {
    const next = { ...targets };
    if (line === null) delete next[accountId];
    else next[accountId] = line;
    setTargets(next);
    submitPlan(chart, defaults, next);
  };

  const result = planner.data;
  const files = result?.files;
  const review = result && "review" in result ? result.review : null;
  const plan = review?.plan;
  const activated = hasAccountingCutover(settings);
  const canApply =
    !activated &&
    !!chart &&
    !!defaults &&
    !!plan &&
    isApplicable(plan) &&
    planner.state === "idle";
  const merged = plan?.merges.length ?? 0;
  const updated = plan?.updates.length ?? 0;
  const created = plan?.creates.length ?? 0;
  const deleted = (plan?.deletes.length ?? 0) - merged;

  const fileSummary = (file: UploadedFile | null, count: number | undefined) =>
    file ? (
      <p className="text-sm text-muted-foreground">
        {count === undefined ? file.name : t`${file.name} · ${count} rows`}
      </p>
    ) : null;

  return (
    <SetupFrame
      title={<Trans>Import chart of accounts</Trans>}
      subtitle={
        <Trans>
          Replace Carbon's default chart with your own, before you set up
          accounting
        </Trans>
      }
      step={review ? "review" : "upload"}
    >
      <SetupBody>
        <SetupSection
          title={<Trans>Chart of accounts</Trans>}
          description={
            <Trans>
              Export your chart from your current system as a CSV, one row per
              account, with its number, name, class, type and group. Carbon
              keeps only the accounts in this file.
            </Trans>
          }
          actions={
            <AccountImportFileButton
              label={chart ? t`Replace chart` : t`Upload chart`}
              isLoading={planner.state !== "idle"}
              onFile={onChart}
            />
          }
        >
          {fileSummary(chart, files?.chart?.count)}
          {files?.chart?.errors && (
            <AccountImportCsvErrors errors={files.chart.errors} />
          )}
        </SetupSection>

        <SetupSection
          title={<Trans>Default accounts</Trans>}
          description={
            <Trans>
              Download the template. Each row is a default account Carbon posts
              to. In Account Number, enter the number of the account in your
              chart that takes it. Carbon updates the default account to match.
            </Trans>
          }
          actions={
            <>
              <Button variant="secondary" leftIcon={<LuDownload />} asChild>
                <Link to={path.to.api.defaultAccountsCsv} reloadDocument>
                  <Trans>Download template</Trans>
                </Link>
              </Button>
              <AccountImportFileButton
                label={defaults ? t`Replace defaults` : t`Upload defaults`}
                isLoading={planner.state !== "idle"}
                onFile={onDefaults}
              />
            </>
          }
        >
          {fileSummary(defaults, files?.defaults?.count)}
          {files?.defaults?.errors && (
            <AccountImportCsvErrors errors={files.defaults.errors} />
          )}
        </SetupSection>

        {review && (
          <AccountImportReview
            plan={review.plan}
            rows={review.rows}
            accounts={review.accounts}
            companies={review.companies}
            targets={targets}
            onTarget={onTarget}
          />
        )}
      </SetupBody>
      <SetupFooter
        summary={
          plan ? (
            <span className="text-muted-foreground">
              {t`${updated} updated · ${created} new · ${merged} merged · ${deleted} deleted`}
            </span>
          ) : null
        }
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link to={path.to.chartOfAccounts}>
                <Trans>Cancel</Trans>
              </Link>
            </Button>
            <Button
              isDisabled={!canApply}
              isLoading={applier.state !== "idle"}
              onClick={() =>
                chart &&
                defaults &&
                applier.submit(
                  {
                    intent: "apply",
                    chart: chart.text,
                    defaults: defaults.text,
                    resolutions: JSON.stringify({ targets })
                  },
                  { method: "post" }
                )
              }
            >
              <Trans>Apply</Trans>
            </Button>
          </>
        }
      />
    </SetupFrame>
  );
}
