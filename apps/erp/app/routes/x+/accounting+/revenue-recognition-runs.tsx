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
import { datetime, formatDate } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCirclePlus } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useNavigate } from "react-router";
import { Confirm } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { getRevenueRecognitionRuns } from "~/modules/accounting";
import { getNextRevenueRecognitionPeriodEnd } from "~/modules/accounting/accounting.utils";
import { RevenueRecognitionRunsTable } from "~/modules/accounting/ui/RevenueRecognition";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Revenue Recognition`,
  to: path.to.revenueRecognitionRuns
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
    getRevenueRecognitionRuns(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    client
      .from("revenueRecognitionRun")
      .select("periodEnd, status")
      .eq("companyId", companyId)
      .order("periodEnd", { ascending: false })
      .limit(1)
  ]);

  const lastRunData =
    lastRun.data && lastRun.data.length > 0 ? lastRun.data[0] : null;
  // The proposed period: the month after the last run, or the month just
  // closed in the company's calendar when there is no run yet.
  const nextPeriodEnd = getNextRevenueRecognitionPeriodEnd(
    lastRunData?.periodEnd ?? null,
    datetime.today(await getCompanyTimeZone(client, companyId)).toString()
  );
  const hasDraftBlocking = lastRunData?.status === "Draft";

  return {
    data: runs.data ?? [],
    count: runs.count ?? 0,
    nextPeriodEnd,
    hasDraftBlocking
  };
}

export default function RevenueRecognitionRunsRoute() {
  const { data, count, nextPeriodEnd, hasDraftBlocking } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const confirmModal = useDisclosure();
  // The modal proposes the next period but lets the user pick another month
  // end: a first run made late, or a period skipped on purpose.
  const [periodEnd, setPeriodEnd] = useState(nextPeriodEnd);

  const canCreate =
    permissions.can("create", "accounting") && !hasDraftBlocking;

  return (
    <VStack spacing={0} className="h-full">
      <RevenueRecognitionRunsTable
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
        action={path.to.newRevenueRecognitionRun}
        isOpen={confirmModal.isOpen}
        title={t`New Run`}
        text={t`This will create a draft revenue recognition run for the period ending ${formatDate(periodEnd)}. Every schedule row due on or before that date will be included.`}
        confirmText={t`Create Run`}
        onCancel={confirmModal.onClose}
        onSubmit={() => {
          confirmModal.onClose();
          navigate(path.to.revenueRecognitionRuns);
        }}
      >
        <div className="flex flex-col gap-1 pb-2">
          <span className="text-sm text-muted-foreground">{t`Period end`}</span>
          <DatePicker
            aria-label={t`Period end`}
            value={parseDate(periodEnd)}
            onChange={(value) => {
              if (value) setPeriodEnd(value.toString());
            }}
          />
        </div>
        <input type="hidden" name="periodEnd" value={periodEnd} />
      </Confirm>

      <Outlet />
    </VStack>
  );
}
