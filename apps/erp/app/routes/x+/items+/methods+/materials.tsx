import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getMethodMaterials } from "~/modules/items";
import { MethodMaterialsTable } from "~/modules/items/ui/Methods";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Method Materials`,
  to: path.to.methodMaterials
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const materials = await getMethodMaterials(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (materials.error) {
    redirect(
      path.to.production,
      await flash(
        request,
        error(materials.error, "Failed to fetch method materials")
      )
    );
  }

  return {
    count: materials.count ?? 0,
    materials: materials.data ?? []
  };
}

export default function MethodMaterialsRoute() {
  const { count, materials } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-[calc(100dvh-var(--topbar-height))]">
      <MethodMaterialsTable data={materials} count={count} />
    </VStack>
  );
}
