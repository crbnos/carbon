// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import { getNextPeriodEnd } from "~/modules/accounting/accounting.utils";
import { DepreciationRunTable } from "~/modules/accounting/ui/FixedAssets";
import type { Handle } from "~/utils/handle";
import { depreciationRunsList } from "~/utils/list-registry/accounting.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Depreciation`,
  to: path.to.depreciationRuns
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, depreciationRunsList, {
    dataKey: "data",
    firstPage: async ({ client, companyId }) => {
      const lastRun = await client
        .from("depreciationRun")
        .select("periodEnd, status")
        .eq("companyId", companyId)
        .order("periodEnd", { ascending: false })
        .limit(1);

      const lastRunData =
        lastRun.data && lastRun.data.length > 0 ? lastRun.data[0] : null;
      const nextPeriodEnd = getNextPeriodEnd(lastRunData?.periodEnd ?? null);
      const hasDraftBlocking = lastRunData?.status === "Draft";

      return {
        lastPeriodEnd: lastRunData?.periodEnd ?? null,
        nextPeriodEnd,
        hasDraftBlocking
      };
    }
  });
}

export default function DepreciationRunsRoute() {
  const {
    data,
    count,
    infinite,
    lastPeriodEnd,
    nextPeriodEnd,
    hasDraftBlocking
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const confirmModal = useDisclosure();
  // The modal proposes the next period but lets the user pick a later month
  // end (catching up several months at once). Depreciation is monthly, so any
  // picked date snaps to its month end.
  // Only the user's pick is state; until they pick, the proposed period shows.
  const [pickedPeriodEnd, setPeriodEnd] = useState<string | null>(null);
  const periodEnd = pickedPeriodEnd ?? nextPeriodEnd;

  const canCreate =
    permissions.can("create", "accounting") && !hasDraftBlocking;

  return (
    <VStack spacing={0} className="h-full">
      <DepreciationRunTable
        data={data}
        count={count}
        infinite={infinite}
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
