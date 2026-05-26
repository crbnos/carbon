import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { ContractorsTable } from "~/modules/resources";
import {
  getAbilitiesList,
  getContractors
} from "~/modules/resources/resources.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Contractors`,
  to: path.to.contractors
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "resources",
    role: "employee",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [contractors, abilities] = await Promise.all([
    getContractors({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getAbilitiesList()
  ]);

  if (contractors.error) {
    throw redirect(
      path.to.resources,
      await flash(
        request,
        error(contractors.error, "Failed to load contractors")
      )
    );
  }

  return {
    contractors: contractors.data ?? [],
    abilities: abilities.data ?? [],
    count: contractors.count ?? 0
  };
}

export default function Route() {
  const { contractors, abilities, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ContractorsTable
        data={contractors}
        count={count}
        // @ts-expect-error TS2322 - TODO: fix type
        abilities={abilities}
      />
      <Outlet />
    </VStack>
  );
}
