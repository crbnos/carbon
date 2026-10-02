// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Button,
  DatePicker,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useDisclosure,
  VStack
} from "@carbon/react";
import { formatDate, isUnaffectedByNavigation } from "@carbon/utils";
import { endOfMonth, parseDate } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCirclePlus } from "react-icons/lu";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { Confirm } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { getDepreciationRuns } from "~/modules/accounting";
import { getNextPeriodEnd } from "~/modules/accounting/accounting.utils";
import { DepreciationRunTable } from "~/modules/accounting/ui/FixedAssets";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Depreciation`,
  to: path.to.depreciationRuns
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { search: "all" })
    ? false
    : args.defaultShouldRevalidate;

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
    getDepreciationRuns(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    client
      .from("depreciationRun")
      .select("periodEnd, status")
      .eq("companyId", companyId)
      .order("periodEnd", { ascending: false })
      .limit(1)
  ]);

  const lastRunData =
    lastRun.data && lastRun.data.length > 0 ? lastRun.data[0] : null;
  const nextPeriodEnd = getNextPeriodEnd(lastRunData?.periodEnd ?? null);
  const hasDraftBlocking = lastRunData?.status === "Draft";

  return {
    data: runs.data ?? [],
    count: runs.count ?? 0,
    lastPeriodEnd: lastRunData?.periodEnd ?? null,
    nextPeriodEnd,
    hasDraftBlocking
  };
}

export default function DepreciationRunsRoute() {
  const { data, count, lastPeriodEnd, nextPeriodEnd, hasDraftBlocking } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const confirmModal = useDisclosure();
  // The modal proposes the next period but lets the user pick a later month
  // end (catching up several months at once). Depreciation is monthly, so any
  // picked date snaps to its month end.
  const [periodEnd, setPeriodEnd] = useState(nextPeriodEnd);

  const canCreate =
    permissions.can("create", "accounting") && !hasDraftBlocking;

  return (
    <VStack spacing={0} className="h-full">
      <DepreciationRunTable
        data={data}
        count={count}
        primaryAction={
          permissions.can("create", "accounting") && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      leftIcon={<LuCirclePlus />}
                      variant="primary"
                      onClick={confirmModal.onOpen}
                      isDisabled={!canCreate}
                    >
                      {t`New Run`}
                    </Button>
                  </span>
                </TooltipTrigger>
                {hasDraftBlocking && (
                  <TooltipContent>
                    {t`A draft run must be posted or deleted first.`}
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )
        }
      />

      <Confirm
        action={path.to.newDepreciationRun}
        isOpen={confirmModal.isOpen}
        title={t`New Run`}
        text={t`This will create a draft depreciation run for the period ending ${formatDate(periodEnd)}. All active assets will be calculated automatically.`}
        confirmText={t`Create Run`}
        onCancel={confirmModal.onClose}
        onSubmit={() => {
          confirmModal.onClose();
          navigate(path.to.depreciationRuns);
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
