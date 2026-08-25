import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Outlet } from "react-router";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | People" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "people"
  });

  return null;
}

export default function PersonRoute() {
  return (
    <div className="flex h-full w-full justify-center bg-card">
      <VStack spacing={4} className="h-full p-4 w-full max-w-[80rem]">
        <Outlet />
      </VStack>
    </div>
  );
}
