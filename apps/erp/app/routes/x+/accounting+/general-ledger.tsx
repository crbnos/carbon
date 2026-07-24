import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, HStack, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { PeriodSelector } from "~/components";
import { AccountControlled } from "~/components/Form/Account";
import { useUrlParams } from "~/hooks";
import {
  getAccount,
  getGeneralLedgerLines,
  getGeneralLedgerOpeningBalance
} from "~/modules/accounting";
import { GeneralLedgerTable } from "~/modules/accounting/ui/GeneralLedger";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { revalidateIgnoringOffset } from "~/utils/revalidate";

export const handle: Handle = {
  breadcrumb: msg`General Ledger`,
  to: path.to.generalLedger
};

export const shouldRevalidate = revalidateIgnoringOffset;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "accounting",
      role: "employee"
    }
  );

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const accountId = searchParams.get("accountId");
  const startDate = searchParams.get("startDate") || null;
  const endDate = searchParams.get("endDate") || null;
  const includeDrafts = searchParams.get("includeDrafts") === "true";
  const status = includeDrafts ? ["Posted", "Reversed", "Draft"] : null;

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const lines = await getGeneralLedgerLines(client, companyId, {
    accountId,
    startDate,
    endDate,
    status,
    limit,
    offset,
    sorts,
    filters
  });

  // Running balance is only meaningful for a single account, default sort, page 1.
  const showRunningBalance =
    !!accountId && offset === 0 && (!sorts || sorts.length === 0);

  let openingBalance: number | null = null;
  let account = null;
  if (accountId) {
    const [opening, accountResult] = await Promise.all([
      showRunningBalance
        ? getGeneralLedgerOpeningBalance(
            client,
            companyGroupId,
            companyId,
            accountId,
            startDate ?? "1900-01-01"
          )
        : Promise.resolve({ data: null, error: null }),
      getAccount(client, accountId)
    ]);
    openingBalance = opening.data;
    account = accountResult.data;
  }

  return {
    lines: lines.data ?? [],
    count: lines.count ?? 0,
    accountId,
    account,
    openingBalance,
    showRunningBalance,
    includeDrafts
  };
}

export default function GeneralLedgerRoute() {
  const {
    lines,
    count,
    accountId,
    account,
    openingBalance,
    showRunningBalance,
    includeDrafts
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const [, setParams] = useUrlParams();

  return (
    <VStack spacing={0} className="h-full">
      <div className="flex px-4 py-3 items-center gap-2 bg-card border-b border-border w-full">
        <HStack>
          <div className="w-72">
            <AccountControlled
              size="sm"
              placeholder={t`All accounts`}
              value={accountId ?? undefined}
              onChange={(value) =>
                setParams({ accountId: value || undefined, offset: undefined })
              }
            />
          </div>
          <PeriodSelector variant="range" />
          <Button
            variant={includeDrafts ? "primary" : "secondary"}
            onClick={() =>
              setParams({
                includeDrafts: includeDrafts ? undefined : "true",
                offset: undefined
              })
            }
          >
            {t`Include drafts`}
          </Button>
        </HStack>
      </div>
      <GeneralLedgerTable
        data={lines}
        count={count}
        openingBalance={account ? openingBalance : null}
        showRunningBalance={showRunningBalance}
      />
      <Outlet />
    </VStack>
  );
}
