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
    <VStack spacing={4} className="h-full p-2">
      <Outlet />
    </VStack>
  );
}
