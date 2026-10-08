// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  RecordOutlet,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { LuDownload, LuEllipsis } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { New } from "~/components";
import { ImportCSVModal } from "~/components/ImportCSVModal";
import { AppBarAction } from "~/components/New";
import { getDepartmentsTree } from "~/modules/people";
import {
  DepartmentsListView,
  DepartmentsTreeView
} from "~/modules/people/ui/Departments";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Departments`,
  to: path.to.departments
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people",
    role: "employee",
    bypassRls: true
  });

  const departments = await getDepartmentsTree(client, companyId);

  if (departments.error) {
    throw redirect(
      path.to.people,
      await flash(
        request,
        error(departments.error, "Failed to load departments")
      )
    );
  }

  return {
    departments: departments.data ?? []
  };
}

export default function Route() {
  const { departments } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  const handleEdit = useCallback(
    (id: string) => {
      navigate(path.to.department(id));
    },
    [navigate]
  );

  const handleDelete = useCallback(
    (id: string) => {
      navigate(path.to.deleteDepartment(id));
    },
    [navigate]
  );

  // Departments render a bespoke tree/list rather than the shared <Table>, so
  // the Bulk Import entry cannot arrive through its `importCSV` prop. Same
  // dropdown shape as TableHeader so the control is where users expect it.
  const [importOpen, setImportOpen] = useState(false);
  // Named `label` deliberately: Lingui bakes the placeholder name into the
  // msgid, so this must match TableHeader's `Import {label} CSV` to reuse its
  // existing translation rather than create a second, untranslated key.
  const label = t`Departments`;

  const handleAddChild = useCallback(
    (parentId: string) => {
      navigate(`${path.to.newDepartment}?parentDepartmentId=${parentId}`);
    },
    [navigate]
  );

  const actionsMenuContent = (
    <DropdownMenuContent align="end">
      <DropdownMenuLabel>
        <Trans>Bulk Import</Trans>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => setImportOpen(true)}>
        <DropdownMenuIcon icon={<LuDownload />} />
        {/* Reuses TableHeader's parameterized msgid rather than
            introducing a second one that every catalog would have to
            translate again. */}
        {t`Import ${label} CSV`}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  // Phones: List/Tree is a display-mode toggle, so it stays a segmented
  // control instead of the compact underline tab row.
  const segmentedTrigger =
    "max-md:hit-area max-md:min-h-9 max-md:rounded-md max-md:border-b-0 max-md:px-3 max-md:data-[state=active]:bg-card max-md:data-[state=active]:shadow-button-base";

  return (
    <Tabs defaultValue="tree" className="w-full">
      <div className="flex px-4 py-3 items-center space-x-4 justify-between bg-card border-b border-border w-full">
        {/* The app bar already names the section on phones. */}
        <Heading size="h3" className="max-md:hidden">
          <Trans>Departments</Trans>
        </Heading>
        <HStack>
          <TabsList className="max-md:w-auto max-md:gap-0 max-md:rounded-lg max-md:border max-md:bg-muted max-md:p-1">
            <TabsTrigger value="tree" className={segmentedTrigger}>
              <Trans>Tree View</Trans>
            </TabsTrigger>
            <TabsTrigger value="list" className={segmentedTrigger}>
              <Trans>List View</Trans>
            </TabsTrigger>
          </TabsList>
          <New
            label={t`Department`}
            to={path.to.newDepartment}
            variant="primary"
          />
          {/* Phones: the content ⋮ moves to the app bar ⋯. */}
          <AppBarAction
            icon={<LuEllipsis />}
            label={t`Table actions`}
            menu={actionsMenuContent}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={t`Table actions`}
                  variant="secondary"
                  icon={<BsThreeDotsVertical />}
                />
              </DropdownMenuTrigger>
              {actionsMenuContent}
            </DropdownMenu>
          </AppBarAction>
        </HStack>
      </div>

      <TabsContent value="tree">
        <DepartmentsTreeView
          departments={departments}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onAddChild={handleAddChild}
        />
      </TabsContent>

      <TabsContent value="list">
        <DepartmentsListView
          departments={departments}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onAddChild={handleAddChild}
        />
      </TabsContent>

      {importOpen && (
        <ImportCSVModal
          table="department"
          onClose={() => setImportOpen(false)}
        />
      )}

      <RecordOutlet />
    </Tabs>
  );
}
