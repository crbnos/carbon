import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { LuCirclePlus } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useNavigate } from "react-router";
import { usePermissions } from "~/hooks";
import { getCompanyBankAccounts } from "~/modules/accounting";
import { CompanyBankAccountsTable } from "~/modules/accounting/ui/BankReconciliation";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Bank Accounts`,
  to: path.to.bankAccounts
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

  const accounts = await getCompanyBankAccounts(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  return {
    data: accounts.data ?? [],
    count: accounts.count ?? 0
  };
}

export default function BankAccountsRoute() {
  const { data, count } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const navigate = useNavigate();

  return (
    <VStack spacing={0} className="h-full">
      <CompanyBankAccountsTable
        data={data}
        count={count}
        primaryAction={
          permissions.can("create", "accounting") && (
            <Button
              leftIcon={<LuCirclePlus />}
              variant="primary"
              onClick={() => navigate(path.to.newBankAccount)}
            >
              Add Bank Account
            </Button>
          )
        }
      />
      <Outlet />
    </VStack>
  );
}
