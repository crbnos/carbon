// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Import a chart of accounts from a CSV (.ai/specs/2026-10-12-chart-of-accounts-import.md).
// The sheet is the whole chart. `plan` shows what the upload would do; `apply`
// runs the same plan in one transaction through the apply-account-import
// server function.

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
import { useRef, useState } from "react";
import { LuDownload, LuFileUp } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, useFetcher } from "react-router";
import {
  SetupBody,
  SetupFooter,
  SetupFrame,
  SetupSection
} from "~/components/Setup";
import { parseAccountImportCsv } from "~/modules/accounting/account-import-csv";
import {
  type AccountImportAccount,
  AccountImportCsvErrors,
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

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, { update: "accounting" });

  const formData = await request.formData();
  const intent = formData.get("intent");
  const parsed = parseAccountImportCsv(String(formData.get("csv") ?? ""));
  if (parsed.errors) {
    return { csvErrors: parsed.errors };
  }
  const resolutions = readResolutions(formData.get("resolutions"));

  if (intent === "apply") {
    const result = await serverFns
      .as({ client, db: getDatabaseClient(), companyId, userId })
      .invoke("apply-account-import", { rows: parsed.rows, resolutions });
    if (result.error) {
      logger.error("Failed to import the chart of accounts", {
        companyId,
        error: result.error
      });
      return data(
        { applyFailed: true },
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
          `Chart imported: ${counts.renamed} renamed, ${counts.created} new, ${counts.merged} merged, ${counts.deleted + counts.deactivated} retired`
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
    const plan = planAccountImport(parsed.rows, ctx, resolutions);
    const accounts: Record<string, AccountImportAccount> = {};
    for (const account of ctx.chart) {
      accounts[account.id] = { number: account.number, name: account.name };
    }
    return {
      plan,
      rows: parsed.rows,
      accounts,
      companies: ctx.companies
    };
  } catch (err) {
    logger.error("Failed to plan the chart of accounts import", {
      companyId,
      error: err
    });
    return data(
      { planFailed: true },
      await flash(request, error(err, "Failed to read the chart of accounts"))
    );
  }
}

export default function ChartOfAccountsImportRoute() {
  const { t } = useLingui();
  const planner = useFetcher<typeof action>();
  const applier = useFetcher<typeof action>();
  const fileInput = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, number>>({});

  const submitPlan = (text: string, nextTargets: Record<string, number>) => {
    planner.submit(
      {
        intent: "plan",
        csv: text,
        resolutions: JSON.stringify({ targets: nextTargets })
      },
      { method: "post" }
    );
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setTargets({});
    submitPlan(text, {});
    if (fileInput.current) fileInput.current.value = "";
  };

  const onTarget = (accountId: string, line: number | null) => {
    if (!csv) return;
    const next = { ...targets };
    if (line === null) delete next[accountId];
    else next[accountId] = line;
    setTargets(next);
    submitPlan(csv, next);
  };

  const result = planner.data;
  const csvErrors = result && "csvErrors" in result ? result.csvErrors : null;
  const review =
    result &&
    "plan" in result &&
    result.plan &&
    result.rows &&
    result.accounts &&
    result.companies
      ? {
          plan: result.plan,
          rows: result.rows,
          accounts: result.accounts,
          companies: result.companies
        }
      : null;
  const canApply =
    !!csv && !!review && isApplicable(review.plan) && planner.state === "idle";
  const plan = review?.plan;
  const renamed = plan?.renames.length ?? 0;
  const merged = plan?.merges.length ?? 0;
  const created = plan?.creates.length ?? 0;
  const retired = plan?.retires.length ?? 0;
  const journals = new Set(plan?.reclasses.map((r) => r.companyId)).size;

  return (
    <SetupFrame
      title={<Trans>Import chart of accounts</Trans>}
      subtitle={
        <Trans>Replace Carbon's default chart with your own, from a CSV</Trans>
      }
      steps={null}
      step={review ? "review" : "upload"}
    >
      <SetupBody>
        <SetupSection
          title={<Trans>Your chart</Trans>}
          description={
            <Trans>
              Download the current chart and edit it in a spreadsheet to match
              your chart. Change a row to rename that account. Delete a row to
              retire the account. Add a row with no Carbon Account to create
              one. Name two Carbon accounts on one row, separated by ";", to
              merge them.
            </Trans>
          }
          actions={
            <>
              <Button variant="secondary" leftIcon={<LuDownload />} asChild>
                <Link to={path.to.api.chartOfAccountsCsv} reloadDocument>
                  <Trans>Download current chart</Trans>
                </Link>
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <Button
                leftIcon={<LuFileUp />}
                isLoading={planner.state !== "idle"}
                onClick={() => fileInput.current?.click()}
              >
                <Trans>Upload CSV</Trans>
              </Button>
            </>
          }
        >
          {csvErrors && <AccountImportCsvErrors errors={csvErrors} />}
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
              {t`${renamed} renamed · ${merged} merged · ${created} new · ${retired} retired · ${journals} reclass journals`}
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
                csv &&
                applier.submit(
                  {
                    intent: "apply",
                    csv,
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
