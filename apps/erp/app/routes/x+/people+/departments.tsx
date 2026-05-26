import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Heading,
  HStack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useCallback } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useNavigate } from "react-router";
import { New } from "~/components";
import { getDepartmentsTree } from "~/modules/people/people.service.server";
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
  await requirePermissions(request, {
    view: "people",
    role: "employee",
    bypassRls: true
  });

  const departments = await getDepartmentsTree();

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

      <Outlet />
    </Tabs>
  );
}
