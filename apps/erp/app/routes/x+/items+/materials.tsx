// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { MaterialsTable } from "~/modules/items/ui/Materials";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  realtime: ["item"],
  breadcrumb: msg`Materials`,
  to: path.to.materials
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "parts",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [materials, tags] = await Promise.all([
    api.items.getMaterials({
      search,
      supplierId,
      limit,
      offset,
      sorts,
      filters
    }),
    api.shared.getTagsList({ table: "material" })
  ]);

  if (materials.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(materials.error, "Failed to fetch materials"))
    );
  }

  return {
    count: materials.data?.count ?? 0,
    materials: materials.data?.rows ?? [],
    tags: tags.data ?? []
  };
}

export default function MaterialsSearchRoute() {
  const { count, materials, tags } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MaterialsTable data={materials} count={count} tags={tags} />
      <RecordOutlet />
    </VStack>
  );
}
