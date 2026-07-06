import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import {
  getStorageTypesList,
  getStorageUnitParentIdsWithChildren,
  getStorageUnitRoots,
  getStorageUnitSubtrees,
  searchStorageUnitsWithAncestors
} from "~/modules/inventory";
import StorageUnitsTable from "~/modules/inventory/ui/StorageUnits/StorageUnitsTable";
import { getLocationsList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Storage Units`,
  to: path.to.storageUnits,
  module: "inventory"
};

// Deepest level (1-based, roots = 1) the tree eagerly loads and pre-expands.
// Nodes below this still render with an expand chevron and lazy-load on click.
const EAGER_EXPAND_MAX_DEPTH = 5;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "inventory",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  let locationId = searchParams.get("location");

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        path.to.storageUnits,
        await flash(
          request,
          error(userDefaults.error, "Failed to load default location")
        )
      );
    }

    locationId = userDefaults.data?.locationId ?? null;
  }

  // Always fetch the locations list server-side so the Location column can
  // render the resolved name on first paint instead of flashing the raw
  // locationId while the client-side useLocations() fetcher catches up.
  const locationsList = await getLocationsList(client, companyId);
  if (locationsList.error || !locationsList.data?.length) {
    throw redirect(
      path.to.storageUnits,
      await flash(
        request,
        error(locationsList.error, "Failed to load any locations")
      )
    );
  }

  if (!locationId) {
    locationId = locationsList.data[0].id as string;
  }

  const [parentIdsWithChildren, storageTypesList] = await Promise.all([
    getStorageUnitParentIdsWithChildren(client, companyId, locationId),
    // Fetch storage types server-side so the Storage Types column can render
    // resolved names on first paint instead of flashing raw ids while the
    // client-side useStorageTypes() fetcher catches up.
    getStorageTypesList(client, companyId)
  ]);

  let rows: any[];
  let count: number;
  let initialExpanded: string[] = [];

  if (search) {
    const searchResult = await searchStorageUnitsWithAncestors(
      client,
      companyId,
      locationId,
      search
    );
    if (searchResult.error) {
      throw redirect(
        path.to.authenticatedRoot,
        await flash(
          request,
          error(searchResult.error, "Failed to fetch storageUnits")
        )
      );
    }
    rows = searchResult.rows;
    count = searchResult.rows.length;
    initialExpanded = searchResult.expandedParentIds;
  } else {
    const rootsResult = await getStorageUnitRoots(
      client,
      companyId,
      locationId,
      { search, limit, offset, sorts, filters }
    );
    if (rootsResult.error) {
      throw redirect(
        path.to.authenticatedRoot,
        await flash(
          request,
          error(rootsResult.error, "Failed to fetch storageUnits")
        )
      );
    }
    const roots = rootsResult.data ?? [];
    count = rootsResult.count ?? 0;

    // Eagerly load the subtrees of the visible (paginated) roots so the tree
    // renders expanded by default instead of lazily loading one level at a
    // time. Pagination still applies to roots; each shown root just arrives
    // with its descendants. The depth cap bounds how much of a deep tree we
    // pull (and pre-expand) up front — anything below it still lazy-loads.
    const descendants = await getStorageUnitSubtrees(
      client,
      companyId,
      locationId,
      roots.map((r) => r.id as string),
      EAGER_EXPAND_MAX_DEPTH
    );
    if (descendants.error) {
      throw redirect(
        path.to.authenticatedRoot,
        await flash(
          request,
          error(descendants.error, "Failed to fetch storageUnits")
        )
      );
    }
    rows = [...roots, ...(descendants.data ?? [])];

    // Pre-expand only nodes whose children were actually loaded (i.e. any node
    // that appears as a parent within the fetched rows). Deriving this from the
    // loaded set — rather than the location-wide parentIdsWithChildren — keeps
    // nodes at the depth cap collapsed so their (unfetched) children lazy-load
    // on click instead of rendering as expanded-but-empty.
    const expandedParents = new Set<string>();
    for (const row of rows) {
      if (row.parentId) expandedParents.add(row.parentId as string);
    }
    initialExpanded = Array.from(expandedParents);
  }

  return {
    count,
    storageUnits: rows,
    parentIdsWithChildren: parentIdsWithChildren.data,
    initialExpanded,
    locations: locationsList.data,
    locationId,
    storageTypes: storageTypesList.data ?? []
  };
}

export default function StorageUnitsRoute() {
  const {
    count,
    storageUnits,
    parentIdsWithChildren,
    initialExpanded,
    locations,
    locationId,
    storageTypes
  } = useLoaderData<typeof loader>();

  // storageUnits comes from storageUnits_recursive (a view) so every column
  // is nominally nullable in the generated types. In practice only roots have
  // a null parentId; id / name / active / companyId / locationId are always
  // populated for rows visible to a user. Narrow by filtering and casting.
  const rows = storageUnits.filter(
    (
      r
    ): r is typeof r & {
      id: string;
      name: string;
      active: boolean;
    } => r.id != null && r.name != null && r.active != null
  );

  return (
    <VStack spacing={0} className="h-full">
      <StorageUnitsTable
        data={rows}
        count={count}
        locations={locations}
        locationId={locationId}
        storageTypes={storageTypes}
        parentIdsWithChildren={parentIdsWithChildren}
        initialExpanded={initialExpanded}
      />
      <Outlet />
    </VStack>
  );
}
