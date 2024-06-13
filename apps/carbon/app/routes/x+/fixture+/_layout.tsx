import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { getUnitOfMeasuresList } from "~/modules/items";
import { getLocationsList } from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Fixtures" }];
};

export const handle: Handle = {
  breadcrumb: "Items",
  to: path.to.items,
  module: "parts",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const [unitOfMeasures, locations] = await Promise.all([
    getUnitOfMeasuresList(client, companyId),
    getLocationsList(client, companyId),
  ]);

  return {
    locations: locations?.data ?? [],
    unitOfMeasures: unitOfMeasures?.data ?? [],
  };
}

export default function FixtureRoute() {
  return (
    <VStack spacing={4} className="h-full p-4">
      <Outlet />
    </VStack>
  );
}
