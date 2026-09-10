import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getMethodOperations } from "~/modules/items";
import { MethodOperationsTable } from "~/modules/items/ui/Methods";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Method Operations`,
  to: path.to.methodOperations
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const operations = await getMethodOperations(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (operations.error) {
    redirect(
      path.to.production,
      await flash(
        request,
        error(operations.error, "Failed to fetch method operations")
      )
    );
  }

  return {
    count: operations.count ?? 0,
    operations: operations.data ?? []
  };
}

export default function MethodOperationsRoute() {
  const { count, operations } = useLoaderData<typeof loader>();

  return (
    <VStack
      spacing={0}
      className="h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]"
    >
      <MethodOperationsTable data={operations} count={count} />
    </VStack>
  );
}
