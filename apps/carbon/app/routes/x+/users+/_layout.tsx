import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { MetaFunction } from "@vercel/remix";
import { GroupedContentSidebar } from "~/components/Layout";
import { useUsersSubmodules } from "~/modules/users";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Users" }];
};

export const handle: Handle = {
  breadcrumb: "Users",
  to: path.to.employeeAccounts,
  module: "users",
};

export default function UsersRoute() {
  const { groups } = useUsersSubmodules();

  return (
    <div className="grid grid-cols-[auto_1fr] w-full h-full">
      <GroupedContentSidebar groups={groups} />
      <VStack spacing={0} className="h-full">
        <Outlet />
      </VStack>
    </div>
  );
}
