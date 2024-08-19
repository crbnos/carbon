import { VStack } from "@carbon/react";
import { type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { requirePermissions } from "~/services/auth/auth.server";

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
