import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useDisclosure,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { LuCirclePlus } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
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
  breadcrumb: "Depreciation",
  to: path.to.depreciationRuns
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
    nextPeriodEnd,
    hasDraftBlocking
  };
}

export default function DepreciationRunsRoute() {
  const { data, count, nextPeriodEnd, hasDraftBlocking } =
    useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const confirmModal = useDisclosure();

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
                      Run Next Period
                    </Button>
                  </span>
                </TooltipTrigger>
                {hasDraftBlocking && (
                  <TooltipContent>
                    A draft run must be posted or deleted first.
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
        title="Run Next Period"
        text={`This will create a draft depreciation run for the period ending ${formatDate(nextPeriodEnd)}. All active assets will be calculated automatically.`}
        confirmText="Create Run"
        onCancel={confirmModal.onClose}
        onSubmit={() => {
          confirmModal.onClose();
          navigate(path.to.depreciationRuns);
        }}
      />
    </VStack>
  );
}
