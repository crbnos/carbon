import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getTrackedEntities } from "~/modules/inventory";
import TrackedEntitiesTable from "~/modules/inventory/ui/Traceability/TrackedEntitiesTable";
import { getCompanySettings } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Tracked Entities`,
  to: path.to.trackedEntities
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [trackedEntities, companySettings] = await Promise.all([
    getTrackedEntities(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getCompanySettings(client, companyId)
  ]);

  if (trackedEntities.error) {
    throw redirect(
      path.to.inventory,
      await flash(request, error(null, "Error loading tracked entities"))
    );
  }

  const inventoryShelfLife = companySettings.data?.inventoryShelfLife as {
    nearExpiryWarningDays?: number | null;
  } | null;

  // Pull the shelf-life policy for every item that shows up in the table so
  // the Expiry trace popover can render the Policy step without an extra
  // round-trip per row. Keyed by itemId.
  const itemIds = Array.from(
    new Set(
      (trackedEntities.data ?? [])
        .map((te) => te.itemId)
        .filter((id): id is string => !!id)
    )
  );
  const shelfLifeRows =
    itemIds.length > 0
      ? await client
          .from("itemShelfLife")
          .select("itemId, mode, days, calculateFromBom")
          .in("itemId", itemIds)
      : {
          data: [] as {
            itemId: string;
            mode: string;
            days: number | null;
            calculateFromBom: boolean | null;
          }[]
        };
  const shelfLifePolicies: Record<
    string,
    {
      mode: string;
      days: number | null;
      calculateFromBom: boolean | null;
    }
  > = {};
  for (const row of shelfLifeRows.data ?? []) {
    if (row.itemId) {
      shelfLifePolicies[row.itemId] = {
        mode: row.mode,
        days: row.days ?? null,
        calculateFromBom: row.calculateFromBom ?? false
      };
    }
  }

  return {
    trackedEntities: trackedEntities.data ?? [],
    count: trackedEntities.count ?? 0,
    nearExpiryWarningDays: inventoryShelfLife?.nearExpiryWarningDays ?? null,
    shelfLifePolicies
  };
}

export default function TraceabilityRoute() {
  const { trackedEntities, count, nearExpiryWarningDays, shelfLifePolicies } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <TrackedEntitiesTable
        data={trackedEntities ?? []}
        count={count ?? 0}
        nearExpiryWarningDays={nearExpiryWarningDays ?? null}
        shelfLifePolicies={shelfLifePolicies ?? {}}
      />
    </VStack>
  );
}
