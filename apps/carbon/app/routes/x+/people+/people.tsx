import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import {
  PeopleTable,
  getAttributeCategories,
  getPeople,
} from "~/modules/people";
import { getEmployeeTypes } from "~/modules/users";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("name");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [attributeCategories, employeeTypes, people] = await Promise.all([
    getAttributeCategories(client, companyId),
    getEmployeeTypes(client, companyId),
    getPeople(client, companyId, { search, limit, offset, sorts, filters }),
  ]);
  if (attributeCategories.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(attributeCategories.error, "Error loading attribute categories")
      )
    );
  }
  if (employeeTypes.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(employeeTypes.error, "Error loading employee types")
      )
    );
  }
  if (people.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(people.error, "Error loading people"))
    );
  }

  return json({
    attributeCategories: attributeCategories.data,
    employeeTypes: employeeTypes.data ?? [],
    people: people.data,
    count: people.count,
  });
}

export default function ResourcesPeopleRoute() {
  const { attributeCategories, count, employeeTypes, people } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PeopleTable
        attributeCategories={attributeCategories}
        data={people ?? []}
        count={count ?? 0}
        employeeTypes={employeeTypes}
      />
      <Outlet />
    </VStack>
  );
}
