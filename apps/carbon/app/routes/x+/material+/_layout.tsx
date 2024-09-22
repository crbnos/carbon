import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs, MetaFunction } from "@vercel/remix";
import { getShelvesList } from "~/modules/inventory";
import {
  getMaterialFormsList,
  getMaterialSubstancesList,
  getUnitOfMeasuresList,
} from "~/modules/items";
import { getLocationsList } from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Materials" }];
};

export const handle: Handle = {
  breadcrumb: "Items",
  to: path.to.items,
  module: "items",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const [unitOfMeasures, locations, forms, substances, shelves] =
    await Promise.all([
      getUnitOfMeasuresList(client, companyId),
      getLocationsList(client, companyId),
      getMaterialFormsList(client, companyId),
      getMaterialSubstancesList(client, companyId),
      getShelvesList(client, companyId),
    ]);

  return {
    locations: locations?.data ?? [],
    unitOfMeasures: unitOfMeasures?.data ?? [],
    forms: forms?.data ?? [],
    substances: substances?.data ?? [],
    shelves: shelves?.data ?? [],
  };
}

export default function MaterialRoute() {
  return <Outlet />;
}
