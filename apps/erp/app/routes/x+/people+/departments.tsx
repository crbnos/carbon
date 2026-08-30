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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { LuDownload } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useNavigate } from "react-router";
import { New } from "~/components";
import { ImportCSVModal } from "~/components/ImportCSVModal";
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

  const handleAddChild = useCallback(
    (parentId: string) => {
      navigate(`${path.to.newDepartment}?parentDepartmentId=${parentId}`);
    },
    [navigate]
  );

  return (
    <Tabs defaultValue="tree" className="w-full">
      <div className="flex px-4 py-3 items-center space-x-4 justify-between bg-card border-b border-border w-full">
        <Heading size="h3">Departments</Heading>
        <HStack>
          <TabsList>
            <TabsTrigger value="tree">Tree View</TabsTrigger>
            <TabsTrigger value="list">List View</TabsTrigger>
          </TabsList>
          <New
            label="Department"
            to={path.to.newDepartment}
            variant="primary"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t`Table actions`}
                variant="secondary"
                icon={<BsThreeDotsVertical />}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                <Trans>Bulk Import</Trans>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setImportOpen(true)}>
                <DropdownMenuIcon icon={<LuDownload />} />
                {t`Import Departments CSV`}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

      <Outlet />
    </Tabs>
  );
}
