import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useMount, VStack } from "@carbon/react";
import { datetime } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { usePanels } from "~/components/Layout";
import { useRealtime } from "~/hooks";
import { getPicksByJobMaterial } from "~/modules/inventory";
import { getItemSupersessionsForItems } from "~/modules/items";
import {
  getJob,
  getJobMaterialItemIds,
  getJobMaterialsWithQuantityOnHand,
  getJobOrderStatusMap
} from "~/modules/production";
import { JobMaterialsTable } from "~/modules/production/ui/Jobs";
import { getCompanySettings } from "~/modules/settings";
import { getLocationTimeZone } from "~/modules/shared/timezone.server";
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
  const [materials, settings, jobItems, picks] = await Promise.all([
    getJobMaterialsWithQuantityOnHand(client, jobId, companyId, locationId, {
      search,
      limit,
      offset,
      sorts,
      // orderStatus is filtered client-side — not a column the RPC can filter on.
      // readableIdWithRevision was the Item filter's column before it moved to
      // jobMaterialItemId; saved views and bookmarks from then still replay it,
      // and the RPC has no such column (42703).
      filters: (filters ?? []).filter(
        (f) =>
          f.column !== "orderStatus" && f.column !== "readableIdWithRevision"
      )
    }),
    getCompanySettings(client, companyId),
    getJobMaterialItemIds(client, jobId, companyId),
    getPicksByJobMaterial(client, jobId, companyId)
  ]);

  if (materials.error) {
    throw redirect(
      path.to.production,
      await flash(
        request,
        error(materials.error, "Failed to fetch job materials")
      )
    );
  }

  if (picks.error) {
    throw redirect(
      path.to.production,
      await flash(request, error(picks.error, "Failed to fetch picks"))
    );
  }

  const rows = materials.data ?? [];
  const nearExpiryWarningDays =
    (
      settings.data?.inventoryShelfLife as {
        nearExpiryWarningDays?: number | null;
      } | null
    )?.nearExpiryWarningDays ?? null;

  const materialItemIds = Array.from(
    new Set(
      rows
        .map((m) => m.jobMaterialItemId)
        .filter((id): id is string => Boolean(id))
    )
  );

  const today = datetime
    .today(await getLocationTimeZone(client, locationId, companyId))
    .toString();

  const [expiredItemIds, orderStatusByMaterialId, supersessions] =
    await Promise.all([
      getExpiredItemIds(
        client,
        companyId,
        rows,
        nearExpiryWarningDays,
        locationId
      ),
      getJobOrderStatusMap(
        client,
        jobId,
        companyId,
        locationId,
        job.data.status,
        rows,
        today
      ),
      getItemSupersessionsForItems(client, materialItemIds, companyId)
    ]);
  if (supersessions.error) {
    throw redirect(
      path.to.production,
      await flash(
        request,
        error(supersessions.error, "Failed to fetch supersessions")
      )
    );
  }
  const consumeFirstByItemId: Record<string, ConsumeFirstRule> = {};
  for (const rule of supersessions.data ?? []) {
    if (rule.supersessionMode !== "Consume First") continue;
    if (!rule.successorItemId) continue;
    if (
      rule.successorEffectivityDate &&
      rule.successorEffectivityDate > today
    ) {
      continue;
    }
    consumeFirstByItemId[rule.itemId] = {
      successorItemId: rule.successorItemId,
      successorReadableId:
        rule.successor?.readableIdWithRevision ?? rule.successorItemId,
      conversionFactor: Number(rule.conversionFactor ?? 1) || 1
    };
  }

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
    orderStatusByMaterialId,
    picksByMaterialId: picks.data,
    consumeFirstByItemId
  };
}

export type ConsumeFirstRule = {
  successorItemId: string;
  successorReadableId: string;
  conversionFactor: number;
};

// Item ids with stock already past its expiration date (the "Expired batch" badge).
async function getExpiredItemIds(
  client: Parameters<typeof getJob>[0],
  companyId: string,
  materials: { jobMaterialItemId: string | null }[],
  nearExpiryWarningDays: number | null,
  locationId: string
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
    .lt(
      "expirationDate",
      datetime
        .today(await getLocationTimeZone(client, locationId, companyId))
        .toString()
    );

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
    orderStatusByMaterialId,
    picksByMaterialId,
    consumeFirstByItemId
  } = useLoaderData<typeof loader>();
  const { jobId } = useParams();
  const { setIsExplorerCollapsed } = usePanels();

  useRealtime("pickingListLine", `jobId=eq.${jobId}`);

  useMount(() => {
    setIsExplorerCollapsed(true);
  });

  return (
    <VStack
      spacing={0}
      className="h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))]"
    >
      <JobMaterialsTable
        data={materials}
        count={count}
        nearExpiryWarningDays={nearExpiryWarningDays}
        jobItemIds={jobItemIds}
        orderStatusByMaterialId={orderStatusByMaterialId}
        picksByMaterialId={picksByMaterialId}
        consumeFirstByItemId={consumeFirstByItemId}
      />
    </VStack>
  );
}
