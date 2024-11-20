import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { PartsTable, getParts } from "~/modules/items";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Parts",
  to: path.to.parts,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [parts, tags] = await Promise.all([
    getParts(client, companyId, {
      search,
      supplierId,
      limit,
      offset,
      sorts,
      filters,
    }),
    getTagsList(client, companyId, "part"),
  ]);

  if (parts.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(parts.error, "Failed to fetch parts"))
    );
  }

  return json({
    count: parts.count ?? 0,
    parts: parts.data ?? [],
    tags: tags.data ?? [],
  });
}

export default function PartsSearchRoute() {
  const { count, parts, tags } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PartsTable data={parts} count={count} tags={tags} />
      <Outlet />
    </VStack>
  );
}
