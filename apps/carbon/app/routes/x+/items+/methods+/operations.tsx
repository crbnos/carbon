import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getMethodOperations, MethodOperationsTable } from "~/modules/items";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Method Operations",
  to: path.to.methodOperations,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee",
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
    filters,
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

  return json({
    count: operations.count ?? 0,
    operations: operations.data ?? [],
  });
}

export default function MethodOperationsRoute() {
  const { count, operations } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-[calc(100vh-49px)]">
      <MethodOperationsTable data={operations} count={count} />
    </VStack>
  );
}
