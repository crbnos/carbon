import { Heading, VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { MetaFunction } from "@vercel/remix";
import { DetailSidebar } from "~/components/Layout/Navigation";
import { useAccountSubmodules } from "~/modules/account";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | My Account" }];
};

export const handle: Handle = {
  breadcrumb: "Account",
  to: path.to.profile,
  module: "account",
};

export default function AccountRoute() {
  const { links } = useAccountSubmodules();

  return (
    <VStack
      className="flex w-full h-full items-center justify-start"
      spacing={4}
    >
      <div className="flex bg-card border-b border-border py-8 px-2 w-full justify-center">
        <div className="w-full max-w-[60rem]">
          <Heading size="h3">Account Settings</Heading>
        </div>
      </div>

      <div className="max-w-[60rem] w-full">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_4fr] h-full w-full gap-8">
          <DetailSidebar links={links} />
          <VStack spacing={0} className="h-full">
            <Outlet />
          </VStack>
        </div>
      </div>
    </VStack>
  );
}
