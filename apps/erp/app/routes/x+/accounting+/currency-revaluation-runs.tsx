// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, DatePicker, useDisclosure, VStack } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { endOfMonth, parseDate } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCirclePlus } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { Confirm } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { getCurrencyRevaluationRuns } from "~/modules/accounting/accounting.service";
import { getNextPeriodEnd } from "~/modules/accounting/accounting.utils";
import { CurrencyRevaluationRunTable } from "~/modules/accounting/ui/CurrencyRevaluation";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Currency Revaluation`,
  to: path.to.currencyRevaluationRuns
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [runs, lastRun] = await Promise.all([
    getCurrencyRevaluationRuns(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    client
      .from("currencyRevaluationRun")
      .select("periodEnd")
      .eq("companyId", companyId)
      .order("periodEnd", { ascending: false })
      .limit(1)
  ]);

  const lastRunData =
    lastRun.data && lastRun.data.length > 0 ? lastRun.data[0] : null;

  return {
    data: runs.data ?? [],
    count: runs.count ?? 0,
    lastPeriodEnd: lastRunData?.periodEnd ?? null,
    nextPeriodEnd: getNextPeriodEnd(lastRunData?.periodEnd ?? null)
  };
}

export default function CurrencyRevaluationRunsRoute() {
  const { data, count, lastPeriodEnd, nextPeriodEnd } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const confirmModal = useDisclosure();
  // The modal proposes the month after the last run but lets the user pick
  // another month end. Revaluation is monthly, so any picked date snaps to its
  // month end. Only the user's pick is state; until they pick, the proposed
  // period shows.
  const [pickedPeriodEnd, setPeriodEnd] = useState<string | null>(null);
  const periodEnd = pickedPeriodEnd ?? nextPeriodEnd;

  return (
    <VStack spacing={0} className="h-full">
      <CurrencyRevaluationRunTable
        data={data}
        count={count}
        primaryAction={
          permissions.can("create", "accounting") && (
            <Button
              leftIcon={<LuCirclePlus />}
              variant="primary"
              onClick={confirmModal.onOpen}
            >
              {t`New Run`}
            </Button>
          )
        }
      />

      <Confirm
        action={path.to.newCurrencyRevaluationRun}
        isOpen={confirmModal.isOpen}
        title={t`New Run`}
        text={t`This will create a draft currency revaluation run for the period ending ${formatDate(periodEnd)}. Every open foreign-currency item will be revalued at the exchange rate on that date.`}
        confirmText={t`Create Run`}
        onCancel={confirmModal.onClose}
        onSubmit={() => {
          confirmModal.onClose();
          navigate(path.to.currencyRevaluationRuns);
        }}
        details={
          <div className="flex flex-col gap-2 pt-4">
            <span className="text-sm font-medium">{t`Period end`}</span>
            <DatePicker
              aria-label={t`Period end`}
              value={parseDate(periodEnd)}
              minValue={
                lastPeriodEnd
                  ? parseDate(lastPeriodEnd).add({ days: 1 })
                  : undefined
              }
              onChange={(value) => {
                if (value) setPeriodEnd(endOfMonth(value).toString());
              }}
            />
          </div>
        }
      >
        <input type="hidden" name="periodEnd" value={periodEnd} />
      </Confirm>
    </VStack>
  );
}
