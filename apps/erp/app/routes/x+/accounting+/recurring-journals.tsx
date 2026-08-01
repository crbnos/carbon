import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, HStack, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { LuRepeat } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useFetcher, useLoaderData } from "react-router";
import { New } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { getRecurringJournalTemplates } from "~/modules/accounting";
import { RecurringJournalsTable } from "~/modules/accounting/ui/RecurringJournals";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Recurring Journals`,
  to: path.to.recurringJournals
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

  return await getRecurringJournalTemplates(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });
}

export default function RecurringJournalsRoute() {
  const { data, count } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const [params] = useUrlParams();
  const generateFetcher = useFetcher();

  return (
    <VStack spacing={0} className="h-full">
      <RecurringJournalsTable
        data={data ?? []}
        count={count ?? 0}
        primaryAction={
          permissions.can("create", "accounting") && (
            <HStack>
              <generateFetcher.Form
                method="post"
                action={path.to.recurringJournalsGenerate}
              >
                <Button
                  type="submit"
                  variant="secondary"
                  leftIcon={<LuRepeat />}
                  isLoading={generateFetcher.state !== "idle"}
                  isDisabled={generateFetcher.state !== "idle"}
                >
                  {t`Generate due now`}
                </Button>
              </generateFetcher.Form>
              <New
                label={t`Recurring Journal`}
                to={`new?${params.toString()}`}
              />
            </HStack>
          )
        }
      />
      <Outlet />
    </VStack>
  );
}
