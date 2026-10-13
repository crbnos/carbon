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
import { Button, File } from "@carbon/react";
import { serverFns } from "@carbon/server-functions";
import { getErrorMessage, redirect } from "@carbon/utils";
import { msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { type ChangeEvent, useState } from "react";
import { LuDownload, LuFileUp } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, useFetcher, useSearchParams } from "react-router";
import {
  SetupBody,
  SetupFooter,
  SetupFrame,
  SetupSection
} from "~/components/Setup";
import {
  type AccountImportCsvError,
  parseChartCsv,
  parseDefaultsCsv
} from "~/modules/accounting/account-import-csv";
import { hasAccountingCutover } from "~/modules/accounting/accounting.utils";
import {
  type AccountImportAccount,
  AccountImportCsvErrors,
  AccountImportReview
} from "~/modules/accounting/ui/ChartOfAccounts";
import { getCompanySettings } from "~/modules/settings";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "accounting/chart-import");

export const handle: Handle = {
  breadcrumb: msg`Import Chart of Accounts`,
  to: path.to.chartOfAccountsImport
};

/** A chart file is a few thousand rows; anything this long is not one. */
const MAX_FILE_LENGTH = 2_000_000;

/** Where Cancel and a finished import go: back to the activation wizard when
 *  the import was opened from it. */
function returnPath(params: URLSearchParams) {
  return params.get("from") === "activation"
    ? path.to.accountingActivationStep("chart")
    : path.to.chartOfAccounts;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "accounting"
  });
  const settings = await getCompanySettings(client, companyId);
  if (settings.error) {
    logger.error("Failed to read the company settings", {
      companyId,
      error: settings.error
    });
  }
  // The chart is imported only before accounting is set up.
  if (hasAccountingCutover(settings.data)) {
    throw redirect(path.to.chartOfAccounts);
  }
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

/** A file field's parse result, or null when no file was uploaded. */
function readFile<Row>(
  value: FormDataEntryValue | null,
  parse: (
    text: string
  ) =>
    | { rows: Row[]; errors: null }
    | { rows: null; errors: AccountImportCsvError[] }
) {
  if (typeof value !== "string") return null;
  if (value.length > MAX_FILE_LENGTH) {
    const errors: AccountImportCsvError[] = [{ code: "too-large" }];
    return { rows: null, errors };
  }
  return parse(value);
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, { update: "accounting" });

  const formData = await request.formData();
  const chart = readFile(formData.get("chart"), parseChartCsv);
  const defaults = readFile(formData.get("defaults"), parseDefaultsCsv);
  const files = {
    chart: chart && { errors: chart.errors, count: chart.rows?.length },
    defaults: defaults && {
      errors: defaults.errors,
      count: defaults.rows?.length
    }
  };
  // The plan needs both files: the chart says which accounts exist, the
  // defaults say which Carbon account each one is.
  if (!chart?.rows || !defaults?.rows) return { files, review: null };
  const resolutions = readResolutions(formData.get("resolutions"));

  if (formData.get("intent") === "apply") {
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
      // Stay on the page, files and picks kept, and say why.
      return data(
        { files, review: null },
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
      returnPath(new URL(request.url).searchParams),
      await flash(
        request,
        success(
          `Chart imported: ${counts.updated} updated, ${counts.created} new, ${counts.merged} merged, ${counts.deleted} deleted`
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
      review: { plan, rows: chart.rows, accounts, companies: ctx.companies }
    };
  } catch (err) {
    logger.error("Failed to plan the chart of accounts import", {
      companyId,
      error: err
    });
    return data(
      { files, review: null },
      await flash(request, error(err, "Failed to read the chart of accounts"))
    );
  }
}

type UploadedFile = { name: string; text: string };

/** Reads the picked file, and clears the input so the same file can be
 *  picked again after it is edited. */
async function readPicked(event: ChangeEvent<HTMLInputElement>) {
  const file = event.target.files?.[0];
  event.target.value = "";
  return file ? { name: file.name, text: await file.text() } : null;
}

export default function ChartOfAccountsImportRoute() {
  const { t } = useLingui();
  const [searchParams] = useSearchParams();
  const planner = useFetcher<typeof action>();
  const applier = useFetcher<typeof action>();
  const [chart, setChart] = useState<UploadedFile | null>(null);
  const [defaults, setDefaults] = useState<UploadedFile | null>(null);
  const [targets, setTargets] = useState<Record<string, number>>({});
  const planning = planner.state !== "idle";

  const submitPlan = (
    nextChart: UploadedFile | null,
    nextDefaults: UploadedFile | null,
    nextTargets: Record<string, number>
  ) => {
    planner.submit(
      {
        intent: "plan",
        ...(nextChart ? { chart: nextChart.text } : {}),
        ...(nextDefaults ? { defaults: nextDefaults.text } : {}),
        resolutions: JSON.stringify({ targets: nextTargets })
      },
      { method: "post" }
    );
  };

  // A new file starts the picks over: they name lines of the old one.
  const onChart = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = await readPicked(event);
    if (!file) return;
    setChart(file);
    setTargets({});
    submitPlan(file, defaults, {});
  };

  const onDefaults = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = await readPicked(event);
    if (!file) return;
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

  const files = planner.data?.files;
  const review = planner.data?.review ?? null;
  const plan = review?.plan;
  const canApply =
    !!chart && !!defaults && !!plan && isApplicable(plan) && !planning;

  const fileSummary = (file: UploadedFile | null, count: number | undefined) =>
    file ? (
      <p className="text-sm text-muted-foreground">
        {count === undefined
          ? file.name
          : t`${file.name} · ${plural(count, { one: "# row", other: "# rows" })}`}
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
              account, with its number, name, class, type and group, or start
              from the template of the current chart. Carbon keeps only the
              accounts in this file.
            </Trans>
          }
          actions={
            <>
              <Button variant="secondary" leftIcon={<LuDownload />} asChild>
                <Link to={path.to.api.chartOfAccountsCsv} reloadDocument>
                  <Trans>Download template</Trans>
                </Link>
              </Button>
              <File
                accept=".csv,text/csv"
                variant="primary"
                leftIcon={<LuFileUp />}
                isLoading={planning}
                onChange={onChart}
              >
                {chart ? t`Replace chart` : t`Upload chart`}
              </File>
            </>
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
              <File
                accept=".csv,text/csv"
                variant="primary"
                leftIcon={<LuFileUp />}
                isLoading={planning}
                onChange={onDefaults}
              >
                {defaults ? t`Replace defaults` : t`Upload defaults`}
              </File>
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
            isDisabled={planning}
            onTarget={onTarget}
          />
        )}
      </SetupBody>
      <SetupFooter
        summary={
          plan ? (
            <span className="text-muted-foreground">
              {t`${plan.updates.length} updated · ${plan.creates.length} new · ${plan.merges.length} merged · ${plan.deletes.length} deleted`}
            </span>
          ) : null
        }
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link to={returnPath(searchParams)}>
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
