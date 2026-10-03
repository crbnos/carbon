// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  Heading,
  HStack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@carbon/react";
import {
  isInternalEmail,
  isUnaffectedByNavigation,
  redirect
} from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, useLoaderData, useNavigate } from "react-router";
import { New } from "~/components";
import { getSubsidiaries } from "~/modules/settings";
import {
  CompaniesListView,
  CompaniesTreeView
} from "~/modules/settings/ui/Companies";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Companies`,
  to: path.to.companies
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args) ? false : args.defaultShouldRevalidate;

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyGroupId, email } = await requirePermissions(request, {
    view: "settings"
  });

  // Multi-company management is gated to internal (Carbon) users for now.
  if (!isInternalEmail(email)) {
    throw redirect(path.to.settings);
  }

  const companies = await getSubsidiaries(
    getCarbonServiceRole(),
    companyGroupId
  );

  if (companies.error) {
    throw redirect(
      path.to.settings,
      await flash(request, error(companies.error, "Failed to load companies"))
    );
  }

  return {
    companies: companies.data ?? []
  };
}

export default function SubsidiariesRoute() {
  const { t } = useLingui();
  const { companies } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const handleDelete = useCallback(
    (id: string) => {
      navigate(path.to.deleteCompany(id));
    },
    [navigate]
  );

  const handleAddChild = useCallback(
    (parentId: string) => {
      navigate(`${path.to.newCompanyInGroup}?parentId=${parentId}`);
    },
    [navigate]
  );

  return (
    <Tabs defaultValue="tree" className="w-full">
      <div className="flex px-4 py-3 items-center space-x-4 justify-between bg-card border-b border-border w-full">
        <Heading size="h3">Companies</Heading>
        <HStack>
          <TabsList>
            <TabsTrigger value="tree">Tree View</TabsTrigger>
            <TabsTrigger value="list">List View</TabsTrigger>
          </TabsList>
          <New
            label={t`Company`}
            to={path.to.newCompanyInGroup}
            variant="primary"
          />
        </HStack>
      </div>

      <TabsContent value="tree">
        <CompaniesTreeView
          // @ts-expect-error
          companies={companies}
          onDelete={handleDelete}
          onAddChild={handleAddChild}
        />
      </TabsContent>

      <TabsContent value="list">
        <CompaniesListView
          // @ts-expect-error
          companies={companies}
          onDelete={handleDelete}
          onAddChild={handleAddChild}
        />
      </TabsContent>

      <Outlet />
    </Tabs>
  );
}
