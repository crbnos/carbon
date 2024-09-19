import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { MetaFunction } from "@vercel/remix";
import { GroupedContentSidebar } from "~/components/Layout";
import { usePeopleSubmodules } from "~/modules/people";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | People" }];
};

export const handle: Handle = {
  breadcrumb: "People",
  to: path.to.people,
  module: "people",
};

export default function PeopleRoute() {
  const { groups } = usePeopleSubmodules();

  return (
    <div className="grid grid-cols-[auto_1fr] w-full h-full">
      <GroupedContentSidebar groups={groups} />
      <VStack spacing={0} className="h-full">
        <Outlet />
      </VStack>
    </div>
  );
}
