// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getAttributeCategories,
  getShiftsList
} from "~/modules/people/people.service";
import { PeopleTable } from "~/modules/people/ui/People";
import { getEmployeeTypes } from "~/modules/users/users.service";
import { loadListPage } from "~/utils/list-registry/load.server";
import { peopleList } from "~/utils/list-registry/people.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, peopleList, {
    dataKey: "people",
    bypassRls: true,
    firstPage: async ({ client, companyId, request }) => {
      const [attributeCategories, employeeTypes, shifts] = await Promise.all([
        getAttributeCategories(client, companyId),
        getEmployeeTypes(client, companyId),
        getShiftsList(client, companyId, null)
      ]);
      if (attributeCategories.error) {
        throw redirect(
          path.to.authenticatedRoot,
          await flash(
            request,
            error(
              attributeCategories.error,
              "Error loading attribute categories"
            )
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
      return {
        attributeCategories: attributeCategories.data ?? [],
        employeeTypes: employeeTypes.data ?? [],
        shifts: shifts.data ?? []
      };
    },
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Error loading people"
    }
  });
}

export default function ResourcesPeopleRoute() {
  const {
    attributeCategories,
    count,
    employeeTypes,
    people,
    shifts,
    infinite
  } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PeopleTable
        attributeCategories={attributeCategories}
        data={people ?? []}
        count={count ?? 0}
        infinite={infinite}
        employeeTypes={employeeTypes}
        shifts={shifts}
      />
      <RecordOutlet />
    </VStack>
  );
}
