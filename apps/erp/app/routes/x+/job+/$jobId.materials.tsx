import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useMount, VStack } from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { usePanels } from "~/components/Layout";
import {
  getJob,
  getJobMaterialItemIds,
  getJobMaterialsWithQuantityOnHand,
  getJobOrderStatusMap
} from "~/modules/production";
import { JobMaterialsTable } from "~/modules/production/ui/Jobs";
import { getCompanySettings } from "~/modules/settings";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const job = await getJob(client, jobId);
  if (job.error) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(job.error, "Failed to fetch job"))
    );
  }

  const locationId = job.data.locationId ?? "";

  // Independent — run in parallel.
  const [materials, settings, jobItems] = await Promise.all([
    getJobMaterialsWithQuantityOnHand(client, jobId, companyId, locationId, {
      search,
      limit,
      offset,
      sorts,
      // orderStatus is filtered client-side — not a column the RPC can filter on.
      filters: (filters ?? []).filter((f) => f.column !== "orderStatus")
    }),
    getCompanySettings(client, companyId),
    getJobMaterialItemIds(client, jobId, companyId)
  ]);

  if (materials.error) {
    redirect(
      path.to.production,
      await flash(
        request,
        error(materials.error, "Failed to fetch job materials")
      )
    );
  }

  const rows = materials.data ?? [];
  const nearExpiryWarningDays =
    (
      settings.data?.inventoryShelfLife as {
        nearExpiryWarningDays?: number | null;
      } | null
    )?.nearExpiryWarningDays ?? null;

  // Both depend on the materials but not on each other.
  const [expiredItemIds, orderStatusByMaterialId] = await Promise.all([
    getExpiredItemIds(client, companyId, rows, nearExpiryWarningDays),
    getJobOrderStatusMap(
      client,
      jobId,
      companyId,
      locationId,
      job.data.status,
      rows
    )
  ]);

  const jobItemIds = Array.from(
    new Set(
      (jobItems.data ?? [])
        .map((row) => row.itemId)
        .filter((id): id is string => Boolean(id))
    )
  );

  return {
    count: materials.count ?? 0,
    jobItemIds,
    materials: rows.map((m) => ({
      ...m,
      hasExpiredBatch: expiredItemIds.has(m.jobMaterialItemId ?? "")
    })),
    nearExpiryWarningDays,
    orderStatusByMaterialId
  };
}

// Item ids with stock already past its expiration date (the "Expired batch" badge).
async function getExpiredItemIds(
  client: Parameters<typeof getJob>[0],
  companyId: string,
  materials: { jobMaterialItemId: string | null }[],
  nearExpiryWarningDays: number | null
): Promise<Set<string>> {
  if (nearExpiryWarningDays === null) return new Set();
  const itemIds = materials
    .map((m) => m.jobMaterialItemId)
    .filter((id): id is string => Boolean(id));
  if (itemIds.length === 0) return new Set();

  const { data } = await client
    .from("trackedEntity")
    .select("sourceDocumentId")
    .in("sourceDocumentId", itemIds)
    .eq("companyId", companyId)
    .not("expirationDate", "is", null)
    .lt("expirationDate", today(getLocalTimeZone()).toString());

  return new Set(
    (data ?? [])
      .map((e) => e.sourceDocumentId)
      .filter((id): id is string => Boolean(id))
  );
}

export default function JobMaterialsRoute() {
  const {
    count,
    materials,
    nearExpiryWarningDays,
    jobItemIds,
    orderStatusByMaterialId
  } = useLoaderData<typeof loader>();
  const { setIsExplorerCollapsed } = usePanels();

  useMount(() => {
    setIsExplorerCollapsed(true);
  });

  return (
    <VStack spacing={0} className="h-[calc(100dvh-99px)]">
      <JobMaterialsTable
        data={materials}
        count={count}
        nearExpiryWarningDays={nearExpiryWarningDays}
        jobItemIds={jobItemIds}
        orderStatusByMaterialId={orderStatusByMaterialId}
      />
    </VStack>
  );
}
