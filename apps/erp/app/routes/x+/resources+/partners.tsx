import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  PartnersTable,
  getAbilitiesList,
  getPartners,
} from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Partners",
  to: path.to.partners,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee",
    bypassRls: true,
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [partners] = await Promise.all([
    getPartners(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getAbilitiesList(client, companyId),
  ]);

  if (partners.error) {
    throw redirect(
      path.to.resources,
      await flash(request, error(partners.error, "Failed to load partners"))
    );
  }

  return json({
    partners: partners.data ?? [],
    count: partners.count ?? 0,
  });
}

export default function Route() {
  const { partners, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PartnersTable data={partners} count={count} />
      <Outlet />
    </VStack>
  );
}
