import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import { type LoaderFunctionArgs, type MetaFunction } from "@vercel/remix";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | People" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "people",
  });

  return null;
}

export default function PersonRoute() {
  return (
    <div className="flex h-full w-full justify-center">
      <VStack spacing={4} className="h-full p-2 w-full max-w-[80rem]">
        <Outlet />
      </VStack>
    </div>
  );
}
