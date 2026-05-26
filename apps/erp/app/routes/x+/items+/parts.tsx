import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getParts } from "~/modules/items/items.service.server";
import { PartsTable } from "~/modules/items/ui/Parts";
import { getTagsList } from "~/modules/shared/shared.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { useRealtime } from "../../../hooks";

export const handle: Handle = {
  breadcrumb: msg`Parts`,
  to: path.to.parts
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [parts, tags] = await Promise.all([
    getParts({
      search,
      supplierId,
      limit,
      offset,
      sorts,
      filters
    }),
    getTagsList("part")
  ]);

  if (parts.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(parts.error, "Failed to fetch parts"))
    );
  }

  return {
    count: parts.count ?? 0,
    parts: parts.data ?? [],
    tags: tags.data ?? []
  };
}

export default function PartsSearchRoute() {
  const { count, parts, tags } = useLoaderData<typeof loader>();

  useRealtime("part");

  return (
    <VStack spacing={0} className="h-full">
      <PartsTable data={parts} count={count} tags={tags} />
      <Outlet />
    </VStack>
  );
}
