import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { PaymentTermsTable, getPaymentTerms } from "~/modules/accounting";
import { requirePermissions } from "~/services/auth/auth.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Payment Terms",
  to: path.to.paymentTerms,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  return json(
    await getPaymentTerms(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    })
  );
}

export default function PaymentTermsRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PaymentTermsTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
