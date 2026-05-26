import { requirePermissions } from "@carbon/auth/auth.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Outlet } from "react-router";
import {
  getMaterialFormsList,
  getMaterialSubstancesList,
  getUnitOfMeasuresList
} from "~/modules/items/items.service.server";
import { getLocationsList } from "~/modules/resources/resources.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Materials" }];
};

export const handle: Handle = {
  breadcrumb: msg`Items`,
  to: path.to.items,
  module: "items"
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts"
  });

  const [unitOfMeasures, locations, forms, substances] = await Promise.all([
    getUnitOfMeasuresList(),
    getLocationsList(),
    getMaterialFormsList(),
    getMaterialSubstancesList()
  ]);

  return {
    locations: locations?.data ?? [],
    unitOfMeasures: unitOfMeasures?.data ?? [],
    forms: forms?.data ?? [],
    substances: substances?.data ?? []
  };
}

export default function MaterialRoute() {
  return <Outlet />;
}
