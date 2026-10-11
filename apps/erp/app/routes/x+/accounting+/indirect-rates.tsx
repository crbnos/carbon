// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import {
  burdenSettingsValidator,
  indirectRateEntryValidator
} from "@carbon/ee/indirect-rates";
import {
  getBurdenSettings,
  getIndirectPools,
  getIndirectRateRuns,
  getIndirectRates,
  runFinalTrueUp,
  runIndirectRatePeriod,
  setIndirectRate,
  updateBurdenSettings
} from "@carbon/ee/indirect-rates.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import {
  Button,
  Heading,
  HStack,
  RecordOutlet,
  ScrollArea,
  VStack
} from "@carbon/react";
import {
  datetime,
  fiscalYearAndPeriodFor,
  MONTH_NUMBER,
  redirect
} from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuFileSpreadsheet, LuFileText, LuPlus } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, useLoaderData } from "react-router";
import { Select } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { usePlanGate } from "~/hooks/usePlanGate";
import { getFiscalYearSettings } from "~/modules/accounting";
import type { IndirectRateRunRow } from "~/modules/accounting/ui/IndirectRates";
import {
  BurdenSettingsForm,
  IndirectRateRuns,
  IndirectRatesGrid,
  IndirectRatesUpgradeOverlay,
  SetIndirectRateModal
} from "~/modules/accounting/ui/IndirectRates";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
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

  const [timeZone, fiscalYearSettings] = await Promise.all([
    getCompanyTimeZone(client, companyId),
    getFiscalYearSettings(client, companyId)
  ]);
  const startMonth =
    MONTH_NUMBER[fiscalYearSettings.data?.startMonth ?? "January"] ?? 1;
  const today = datetime.today(timeZone);
  const currentFiscalYear = fiscalYearAndPeriodFor(
    today.year,
    today.month,
    startMonth
  ).fiscalYear;
  const fiscalYear =
    parseFiscalYear(new URL(request.url).searchParams.get("fiscalYear")) ??
    currentFiscalYear;

  const [pools, rates, runs, settings, lockedPeriods] = await Promise.all([
    getIndirectPools(client, companyId),
    getIndirectRates(client, { companyId, fiscalYear }),
    getIndirectRateRuns(client, companyId),
    getBurdenSettings(client, companyId),
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
    settings,
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
      appliedPools.every((pool) => finalPeriod12.has(pool.id)),
    burdenSettings: {
      burdenRateType: (settings.data?.burdenRateType === "Actual"
        ? "Actual"
        : "Provisional") as "Provisional" | "Actual",
      postAppliedBurden: settings.data?.postAppliedBurden ?? false
    }
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
      case "settings": {
        const validation = await validator(burdenSettingsValidator).validate(
          formData
        );
        if (validation.error) return validationError(validation.error);
        const result = await updateBurdenSettings(client, {
          ...validation.data,
          companyId,
          userId
        });
        if (result.error) {
          logger.error("Failed to update the burden settings", {
            companyId,
            error: result.error
          });
          return refuse(result.error, "Failed to save the burden settings");
        }
        return done("Burden settings saved");
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
  const {
    fiscalYear,
    currentFiscalYear,
    startMonth,
    pools,
    rates,
    runs,
    lockedPeriods,
    canTrueUp,
    burdenSettings
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { isGated } = usePlanGate({ feature: "GOVERNMENT_CONTRACTING" });
  const permissions = usePermissions();
  const [, setParams] = useUrlParams();
  const [settingRate, setSettingRate] = useState(false);

  if (isGated) {
    return <IndirectRatesUpgradeOverlay />;
  }

  const canUpdate = permissions.can("update", "accounting");
  const activePools = pools.filter((pool) => pool.active);
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
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <VStack spacing={4} className="w-full px-4 py-6">
        <HStack className="w-full flex-wrap justify-between gap-2">
          <HStack className="gap-3">
            <Heading size="h3">
              <Trans>Indirect Rates</Trans>
            </Heading>
            <Select
              aria-label={t`Fiscal year`}
              size="sm"
              value={String(fiscalYear)}
              options={years.map((year) => ({
                label: t`FY${year}`,
                value: String(year)
              }))}
              onChange={(value) => setParams({ fiscalYear: value })}
            />
          </HStack>
          <HStack>
            <Button asChild variant="secondary" leftIcon={<LuFileText />}>
              <Link to={path.to.indirectRatesStatement(fiscalYear)}>
                <Trans>Statement</Trans>
              </Link>
            </Button>
            <Button
              asChild
              variant="secondary"
              leftIcon={<LuFileSpreadsheet />}
            >
              <Link to={path.to.indirectRatesIce(fiscalYear)}>
                <Trans>ICE Export</Trans>
              </Link>
            </Button>
            <Button
              variant="primary"
              leftIcon={<LuPlus />}
              isDisabled={!canUpdate || activePools.length === 0}
              onClick={() => setSettingRate(true)}
            >
              <Trans>Set Rate</Trans>
            </Button>
          </HStack>
        </HStack>

        <IndirectRatesGrid
          pools={pools}
          rates={rates}
          startMonth={startMonth}
        />

        <IndirectRateRuns
          runs={runs}
          lockedPeriods={lockedPeriods}
          fiscalYear={fiscalYear}
          canTrueUp={canTrueUp}
          action={path.to.indirectRates}
          isDisabled={!canUpdate}
        />

        <BurdenSettingsForm
          key={`${burdenSettings.burdenRateType}:${burdenSettings.postAppliedBurden}`}
          initialValues={burdenSettings}
          action={path.to.indirectRates}
          isDisabled={!canUpdate}
        />
      </VStack>

      {settingRate && (
        <SetIndirectRateModal
          pools={activePools}
          fiscalYear={fiscalYear}
          action={path.to.indirectRates}
          onClose={() => setSettingRate(false)}
        />
      )}

      <RecordOutlet />
    </ScrollArea>
  );
}
