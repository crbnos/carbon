// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import { indirectRateEntryValidator } from "@carbon/ee/indirect-rates";
import {
  getIndirectPools,
  getIndirectRateRuns,
  getIndirectRates,
  runFinalTrueUp,
  runIndirectRatePeriod,
  setIndirectRate
} from "@carbon/ee/indirect-rates.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { usePermissions, useUrlParams } from "~/hooks";
import { usePlanGate } from "~/hooks/usePlanGate";
import { getCurrentFiscalYear } from "~/modules/accounting/accounting.service";
import type { IndirectRateRunRow } from "~/modules/accounting/ui/IndirectRates";
import {
  IndirectRateRuns,
  IndirectRatesUpgradeOverlay
} from "~/modules/accounting/ui/IndirectRates";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "indirect-rates");

export const handle: Handle = {
  breadcrumb: msg`Indirect Rates`,
  to: path.to.indirectRates
};

/** A `?fiscalYear` that is not a year falls back to the current one. */
function parseFiscalYear(raw: string | null): number | null {
  const year = Number(raw);
  return Number.isInteger(year) && year >= 1900 && year <= 9999 ? year : null;
}

// The page loads without a plan check: a gated company sees the upgrade
// overlay. Every intent calls requireFeature, and the ee functions lock.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { fiscalYear: currentFiscalYear, startMonth } =
    await getCurrentFiscalYear(client, companyId);
  const fiscalYear =
    parseFiscalYear(new URL(request.url).searchParams.get("fiscalYear")) ??
    currentFiscalYear;

  const [pools, rates, runs, lockedPeriods] = await Promise.all([
    getIndirectPools(client, companyId),
    getIndirectRates(client, { companyId, fiscalYear }),
    getIndirectRateRuns(client, companyId),
    client
      .from("accountingPeriod")
      .select("id, startDate")
      .eq("companyId", companyId)
      .eq("closeStatus", "Locked")
      .order("startDate", { ascending: false })
  ]);

  for (const [name, result] of Object.entries({
    pools,
    rates,
    runs,
    lockedPeriods
  })) {
    if (result.error) {
      logger.error("Failed to load the indirect rates page", {
        companyId,
        fiscalYear,
        read: name,
        error: result.error
      });
    }
  }

  const activePools = (pools.data ?? []).filter((pool) => pool.active);
  const finalPeriod12 = new Set(
    (rates.data ?? [])
      .filter((rate) => rate.rateType === "Final" && rate.periodNumber === 12)
      .map((rate) => rate.indirectPoolId)
  );
  const appliedPools = activePools.filter((pool) => pool.appliesToProjects);

  return {
    fiscalYear,
    currentFiscalYear,
    startMonth,
    pools: pools.data ?? [],
    rates: rates.data ?? [],
    runs: ((runs.data ?? []) as IndirectRateRunRow[]).filter(
      (run) => run.fiscalYear === fiscalYear
    ),
    lockedPeriods: lockedPeriods.data ?? [],
    canTrueUp:
      appliedPools.length > 0 &&
      appliedPools.every((pool) => finalPeriod12.has(pool.id))
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  await requireFeature({
    request,
    client,
    companyId,
    feature: "GOVERNMENT_CONTRACTING",
    redirectTo: path.to.indirectRates
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  const refuse = async (err: unknown, message: string) =>
    data({ success: false }, await flash(request, error(err, message)));
  const done = async (message: string) =>
    data({ success: true }, await flash(request, success(message)));

  try {
    switch (intent) {
      case "set-rate": {
        const validation = await validator(indirectRateEntryValidator).validate(
          formData
        );
        if (validation.error) return validationError(validation.error);
        const result = await setIndirectRate(client, {
          ...validation.data,
          companyId,
          userId
        });
        if (result.error) {
          logger.error("Failed to set an indirect rate", {
            companyId,
            error: result.error
          });
          return refuse(result.error, result.error.message);
        }
        return done("Rate saved");
      }
      case "run":
      case "true-up": {
        const accountingPeriodId = formData.get("accountingPeriodId");
        if (typeof accountingPeriodId !== "string" || !accountingPeriodId) {
          return refuse(null, "Choose a locked period");
        }
        const db = getDatabaseClient();
        const fiscalYear = Number(formData.get("fiscalYear"));
        if (intent === "true-up" && !Number.isInteger(fiscalYear)) {
          return refuse(null, "Choose a fiscal year");
        }
        const result =
          intent === "run"
            ? await runIndirectRatePeriod(db, client, {
                companyId,
                userId,
                accountingPeriodId
              })
            : await runFinalTrueUp(db, client, {
                companyId,
                userId,
                fiscalYear,
                accountingPeriodId
              });
        if (result.error) {
          logger.error("The indirect rate run failed", {
            companyId,
            accountingPeriodId,
            intent,
            error: result.error
          });
          return refuse(result.error, result.error.message);
        }
        return done(
          intent === "run" ? "Period run complete" : "True-up complete"
        );
      }
      default:
        return refuse(null, "Unknown action");
    }
  } catch (err) {
    if (!(err instanceof EntitlementError)) throw err;
    logger.error("Indirect rates are not in the company's plan", {
      companyId
    });
    throw redirect(
      path.to.indirectRates,
      await flash(request, error(err, "Upgrade to use indirect rates"))
    );
  }
}

export default function IndirectRatesRoute() {
  const { fiscalYear, currentFiscalYear, runs, lockedPeriods, canTrueUp } =
    useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "GOVERNMENT_CONTRACTING" });
  const permissions = usePermissions();
  const [, setParams] = useUrlParams();

  if (isGated) {
    return <IndirectRatesUpgradeOverlay />;
  }

  const years = Array.from(
    new Set([
      currentFiscalYear + 1,
      currentFiscalYear,
      currentFiscalYear - 1,
      currentFiscalYear - 2,
      fiscalYear
    ])
  ).sort((a, b) => b - a);

  return (
    <VStack spacing={0} className="h-full">
      <IndirectRateRuns
        runs={runs}
        lockedPeriods={lockedPeriods}
        fiscalYear={fiscalYear}
        years={years}
        onFiscalYearChange={(value) => setParams({ fiscalYear: value })}
        canTrueUp={canTrueUp}
        action={path.to.indirectRates}
        isDisabled={!permissions.can("update", "accounting")}
      />
      <RecordOutlet />
    </VStack>
  );
}
