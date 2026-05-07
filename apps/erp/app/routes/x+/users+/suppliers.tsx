import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getSupplierTypes } from "~/modules/purchasing";
import {
  getSuppliers,
  getUnrevokedInviteEmails,
  SupplierAccountsTable
} from "~/modules/users";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Suppliers`,
  to: path.to.supplierAccounts
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "users",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [suppliers, supplierTypes, invites] = await Promise.all([
    getSuppliers(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getSupplierTypes(client, companyId),
    getUnrevokedInviteEmails(client, companyId)
  ]);
  if (suppliers.error) {
    throw redirect(
      path.to.users,
      await flash(request, error(suppliers.error, "Error loading suppliers"))
    );
  }
  if (supplierTypes.error) {
    throw redirect(
      path.to.users,
      await flash(
        request,
        error(supplierTypes.error, "Error loading supplier types")
      )
    );
  }

  return {
    count: suppliers.count ?? 0,
    suppliers: suppliers.data,
    supplierTypes: supplierTypes.data,
    unrevokedInviteEmails: invites.data?.map((i) => i.email) ?? []
  };
}

export default function UsersSuppliersRoute() {
  const { count, suppliers, supplierTypes, unrevokedInviteEmails } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SupplierAccountsTable
        data={suppliers}
        count={count}
        supplierTypes={supplierTypes}
        unrevokedInviteEmails={unrevokedInviteEmails}
      />
      <Outlet />
    </VStack>
  );
}
